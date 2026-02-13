/**
 * Obsidian Notes Publisher - Live Server V2
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Import modules
const { fetchNotes, clearCache, getAttachment, resolveNoteId } = require('./lib/drive');
const {
    getGoogleAuthUrl,
    handleGoogleCallback,
    logoutUser,
    authMiddleware,
    requireAuth,
    requireAdmin,
    getAllUsers,
    setUserRole,
    blockUser,
    unblockUser,
    isOAuthConfigured
} = require('./lib/oauth');
const {
    createComment,
    getCommentsForNote,
    updateComment,
    deleteComment,
    threadComments
} = require('./lib/comments');
const {
    recordPageView,
    updateTimeSpent,
    getDashboardStats,
    saveReadingPosition,
    getReadingHistory
} = require('./lib/analytics');
const { statements } = require('./lib/db');

const SESSION_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const JSON_BODY_LIMIT = '250kb';
const DESIGN_CONCEPTS = new Set(['concept-01', 'concept-02', 'concept-03', 'concept-04', 'concept-05']);

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function isDesignPreviewEnabled() {
    return !isProduction() && process.env.DESIGN_PREVIEW === '1';
}

function normalizeDesignConcept(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return DESIGN_CONCEPTS.has(normalized) ? normalized : null;
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function buildOriginAllowlist() {
    const explicit = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

    const defaults = isProduction()
        ? []
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'];

    const base = process.env.BASE_URL ? [process.env.BASE_URL] : [];
    return new Set([...defaults, ...base, ...explicit]);
}

function createCorsMiddleware() {
    const allowlist = buildOriginAllowlist();

    return cors({
        credentials: true,
        origin(origin, cb) {
            if (!origin) {
                cb(null, true);
                return;
            }

            if (allowlist.has(origin)) {
                cb(null, true);
                return;
            }

            cb(new Error('CORS origin denied'));
        }
    });
}

function createInMemoryRateLimiter({ windowMs, max, keyPrefix }) {
    const buckets = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const bucketKey = `${keyPrefix}:${req.ip || 'unknown'}`;
        const existing = buckets.get(bucketKey);

        if (!existing || now > existing.resetAt) {
            buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }

        existing.count += 1;
        if (existing.count > max) {
            const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
            res.set('Retry-After', String(Math.max(1, retryAfterSec)));
            res.status(429).json({ error: 'Too many requests. Try again later.' });
            return;
        }

        next();
    };
}

function applySecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Keep inline script/style support for existing static templates.
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: https:",
            "font-src 'self' https://fonts.gstatic.com data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'"
        ].join('; ')
    );

    next();
}

function ensureAnonymousSession(req, res, next) {
    let sessionId = req.cookies?.session_id;

    if (!sessionId) {
        sessionId = crypto.randomUUID();
        res.cookie('session_id', sessionId, {
            httpOnly: true,
            secure: isProduction(),
            sameSite: 'lax',
            maxAge: SESSION_COOKIE_MAX_AGE
        });
    }

    req.sessionId = sessionId;
    next();
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asTrimmedString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return fallback;
}

async function resolveNoteContext(noteId) {
    const data = await fetchNotes();
    const canonicalId = resolveNoteId(noteId);
    const note = data.notes.find((n) => n.id === canonicalId || n.legacyId === noteId);
    return { data, note, canonicalId };
}

function mergeComments(primary, secondary) {
    const seen = new Set();
    const merged = [];

    for (const comment of [...primary, ...secondary]) {
        if (seen.has(comment.id)) continue;
        seen.add(comment.id);
        merged.push(comment);
    }

    return merged;
}

function createApp() {
    const app = express();

    app.set('trust proxy', 1);

    // Middleware
    app.use(createCorsMiddleware());
    app.use(createInMemoryRateLimiter({
        windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        max: toInt(process.env.RATE_LIMIT_MAX, 500),
        keyPrefix: 'global'
    }));
    app.use(express.json({ limit: JSON_BODY_LIMIT }));
    app.use(cookieParser());
    app.use(ensureAnonymousSession);
    app.use(applySecurityHeaders);
    app.use(authMiddleware);

    app.use('/api/auth', createInMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 120, keyPrefix: 'api-auth' }));
    app.use('/api/feedback', createInMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, keyPrefix: 'api-feedback' }));

    if (isDesignPreviewEnabled()) {
        const redesignsDir = path.join(__dirname, 'redesigns');
        app.use('/redesigns', express.static(redesignsDir));
    }

    // Serve static files from dist folder
    app.use(express.static(path.join(__dirname, 'dist')));

    // ===========================================
    // AUTH ROUTES (OAuth)
    // ===========================================

    // Check OAuth configuration status
    app.get('/api/auth/config', (req, res) => {
        res.json({
            googleEnabled: isOAuthConfigured(),
            appleEnabled: false
        });
    });

    // Start Google OAuth flow
    app.get('/auth/google', (req, res) => {
        try {
            if (!isOAuthConfigured()) {
                return res.status(503).json({ error: 'Google OAuth not configured' });
            }
            const authUrl = getGoogleAuthUrl();
            return res.redirect(authUrl);
        } catch (error) {
            console.error('Google OAuth error:', error);
            return res.redirect('/?error=oauth_failed');
        }
    });

    // Google OAuth callback
    app.get('/auth/google/callback', async (req, res) => {
        try {
            const { code, error } = req.query;

            if (error) {
                console.error('Google OAuth denied:', error);
                return res.redirect('/?error=oauth_denied');
            }

            if (!code) {
                return res.redirect('/?error=no_code');
            }

            const result = await handleGoogleCallback(code);

            // Set session cookie
            res.cookie('session_token', result.session.token, {
                httpOnly: true,
                secure: isProduction(),
                sameSite: 'lax',
                maxAge: 30 * 24 * 60 * 60 * 1000
            });

            return res.redirect('/');
        } catch (error) {
            console.error('Google OAuth callback error:', error);
            return res.redirect('/?error=oauth_failed');
        }
    });

    // Logout
    app.post('/api/auth/logout', (req, res) => {
        const token = req.cookies?.session_token;
        if (token) {
            logoutUser(token);
        }
        res.clearCookie('session_token');
        res.json({ success: true });
    });

    // Get current user
    app.get('/api/auth/me', (req, res) => {
        if (req.user) {
            res.json({
                user: req.user,
                isAdmin: req.user.role === 'admin'
            });
        } else {
            res.json({ user: null });
        }
    });

    // ===========================================
    // ADMIN ROUTES
    // ===========================================

    app.get('/api/admin/users', requireAdmin, (req, res) => {
        try {
            const users = getAllUsers();
            res.json({ users });
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });

    app.post('/api/admin/users/:userId/role', requireAdmin, (req, res) => {
        try {
            const { userId } = req.params;
            const role = asTrimmedString(req.body?.role);

            if (!role) {
                return res.status(400).json({ error: 'Role is required' });
            }

            if (userId === req.user.id) {
                return res.status(400).json({ error: 'Cannot change your own role' });
            }

            setUserRole(userId, role);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error updating user role:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/admin/users/:userId/block', requireAdmin, (req, res) => {
        try {
            const { userId } = req.params;

            if (userId === req.user.id) {
                return res.status(400).json({ error: 'Cannot block yourself' });
            }

            blockUser(userId);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error blocking user:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/admin/users/:userId/unblock', requireAdmin, (req, res) => {
        try {
            const { userId } = req.params;
            unblockUser(userId);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error unblocking user:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/admin/feedback', requireAdmin, (req, res) => {
        try {
            const feedback = statements.getAllFeedback.all();
            res.json({ feedback });
        } catch (error) {
            console.error('Error fetching feedback:', error);
            res.status(500).json({ error: 'Failed to fetch feedback' });
        }
    });

    app.post('/api/admin/feedback/:feedbackId/read', requireAdmin, (req, res) => {
        try {
            statements.markFeedbackRead.run(req.params.feedbackId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error marking feedback:', error);
            res.status(500).json({ error: 'Failed to update feedback' });
        }
    });

    // ===========================================
    // NOTES ROUTES
    // ===========================================

    app.get('/api/notes', async (req, res) => {
        try {
            const data = await fetchNotes();
            res.json({
                siteName: data.siteName,
                notes: data.notes,
                folderTree: data.folderTree
            });
        } catch (error) {
            console.error('Error fetching notes:', error);
            res.status(500).json({ error: 'Failed to fetch notes', message: error.message });
        }
    });

    app.get('/api/notes/:noteId', async (req, res) => {
        try {
            const { note, canonicalId } = await resolveNoteContext(req.params.noteId);

            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const viewId = recordPageView(canonicalId, req.user?.id || null, req.sessionId || null);

            return res.json({ note, viewId, canonicalId });
        } catch (error) {
            console.error('Error fetching note:', error);
            return res.status(500).json({ error: 'Failed to fetch note' });
        }
    });

    app.get('/api/search', async (req, res) => {
        try {
            const data = await fetchNotes();
            res.json(data.searchIndex);
        } catch (error) {
            console.error('Error fetching search index:', error);
            res.status(500).json({ error: 'Failed to fetch search index' });
        }
    });

    app.post('/api/refresh', requireAdmin, (req, res) => {
        clearCache();
        res.json({ success: true, message: 'Cache cleared' });
    });

    app.get('/api/attachment/:filename', async (req, res) => {
        try {
            const { filename } = req.params;
            const { data, mimeType } = await getAttachment(decodeURIComponent(filename));
            res.set('Content-Type', mimeType);
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(data);
        } catch (error) {
            console.error('Error fetching attachment:', error);
            res.status(404).json({ error: 'Attachment not found' });
        }
    });

    // ===========================================
    // COMMENTS ROUTES
    // ===========================================

    app.get('/api/notes/:noteId/comments', async (req, res) => {
        try {
            const { note, canonicalId } = await resolveNoteContext(req.params.noteId);
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const primary = getCommentsForNote(canonicalId, req.user?.id);
            const withLegacy = note.legacyId && note.legacyId !== canonicalId
                ? getCommentsForNote(note.legacyId, req.user?.id)
                : [];

            const threaded = threadComments(mergeComments(primary, withLegacy));
            return res.json({ comments: threaded, canonicalId });
        } catch (error) {
            console.error('Error fetching comments:', error);
            return res.status(500).json({ error: 'Failed to fetch comments' });
        }
    });

    app.post('/api/notes/:noteId/comments', requireAuth, async (req, res) => {
        try {
            const { note, canonicalId } = await resolveNoteContext(req.params.noteId);
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const content = asTrimmedString(req.body?.content);
            const parentId = asTrimmedString(req.body?.parentId);
            const isPublic = parseBoolean(req.body?.isPublic, false);

            if (!content) {
                return res.status(400).json({ error: 'Content is required' });
            }

            const comment = createComment(
                canonicalId,
                req.user.id,
                content,
                isPublic,
                parentId || null
            );

            return res.status(201).json({ comment });
        } catch (error) {
            console.error('Error creating comment:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    app.put('/api/comments/:commentId', requireAuth, (req, res) => {
        try {
            const content = asTrimmedString(req.body?.content);
            const isPublic = parseBoolean(req.body?.isPublic, false);

            if (!content) {
                return res.status(400).json({ error: 'Content is required' });
            }

            updateComment(req.params.commentId, req.user.id, content, isPublic);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error updating comment:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    app.delete('/api/comments/:commentId', requireAuth, (req, res) => {
        try {
            deleteComment(req.params.commentId, req.user.id);
            return res.json({ success: true });
        } catch (error) {
            console.error('Error deleting comment:', error);
            return res.status(400).json({ error: error.message });
        }
    });

    // ===========================================
    // ANALYTICS ROUTES
    // ===========================================

    app.post('/api/analytics/time', (req, res) => {
        try {
            const viewId = Number(req.body?.viewId);
            const seconds = Number(req.body?.seconds);

            if (!Number.isInteger(viewId) || viewId <= 0) {
                return res.status(400).json({ error: 'Invalid viewId' });
            }

            if (!Number.isFinite(seconds) || seconds < 0) {
                return res.status(400).json({ error: 'Invalid seconds' });
            }

            updateTimeSpent(viewId, seconds, {
                userId: req.user?.id || null,
                sessionId: req.sessionId || null
            });

            return res.json({ success: true });
        } catch (error) {
            return res.status(403).json({ error: error.message || 'Failed to record time' });
        }
    });

    app.get('/api/analytics/dashboard', requireAuth, (req, res) => {
        try {
            const stats = getDashboardStats();
            res.json(stats);
        } catch (error) {
            console.error('Error fetching analytics:', error);
            res.status(500).json({ error: 'Failed to fetch analytics' });
        }
    });

    app.post('/api/reading/position', requireAuth, async (req, res) => {
        try {
            const { note, canonicalId } = await resolveNoteContext(req.body?.noteId);
            const scrollPosition = Number(req.body?.scrollPosition);

            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            if (!Number.isFinite(scrollPosition) || scrollPosition < 0 || scrollPosition > 1) {
                return res.status(400).json({ error: 'Invalid scrollPosition' });
            }

            saveReadingPosition(req.user.id, canonicalId, scrollPosition);
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to save position' });
        }
    });

    app.get('/api/reading/history', requireAuth, (req, res) => {
        try {
            const history = getReadingHistory(req.user.id, 20);
            res.json({ history });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch history' });
        }
    });

    // ===========================================
    // USER SETTINGS ROUTES
    // ===========================================

    app.get('/api/settings', requireAuth, (req, res) => {
        try {
            const result = statements.getSettings.get(req.user.id);
            const settings = result ? JSON.parse(result.settings_json) : {};
            res.json({ settings });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch settings' });
        }
    });

    app.post('/api/settings', requireAuth, (req, res) => {
        try {
            const settings = req.body?.settings;

            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                return res.status(400).json({ error: 'Invalid settings payload' });
            }

            const serialized = JSON.stringify(settings);
            if (serialized.length > 25_000) {
                return res.status(400).json({ error: 'Settings payload too large' });
            }

            statements.upsertSettings.run(req.user.id, serialized);
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to save settings' });
        }
    });

    // ===========================================
    // SHARE ROUTES
    // ===========================================

    app.get('/api/share/:noteId', async (req, res) => {
        try {
            const { note, canonicalId } = await resolveNoteContext(req.params.noteId);
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
            const shareUrl = `${baseUrl}/notes/${canonicalId}`;
            return res.json({ shareUrl, canonicalId });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to generate share link' });
        }
    });

    // ===========================================
    // FEEDBACK ROUTES
    // ===========================================

    app.post('/api/feedback', async (req, res) => {
        try {
            const type = asTrimmedString(req.body?.type) || 'other';
            const email = asTrimmedString(req.body?.email);
            const message = asTrimmedString(req.body?.message);

            if (!message) {
                return res.status(400).json({ error: 'Message is required' });
            }

            if (message.length > 5000) {
                return res.status(400).json({ error: 'Message is too long (max 5000 chars)' });
            }

            if (email && !isValidEmail(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const allowedTypes = new Set(['error', 'suggestion', 'content', 'bug', 'other']);
            if (!allowedTypes.has(type)) {
                return res.status(400).json({ error: 'Invalid feedback type' });
            }

            const id = uuidv4();
            const userId = req.user?.id || null;
            const feedbackEmail = email || req.user?.email || null;

            statements.createFeedback.run(id, userId, feedbackEmail, type, message);

            try {
                const { sendFeedbackNotification } = require('./lib/email');
                await sendFeedbackNotification({
                    type,
                    email: feedbackEmail,
                    message
                });
            } catch (emailError) {
                console.error('Failed to send email notification:', emailError);
            }

            return res.status(201).json({ success: true, message: 'Feedback submitted successfully' });
        } catch (error) {
            console.error('Error submitting feedback:', error);
            return res.status(500).json({ error: 'Failed to submit feedback' });
        }
    });

    // ===========================================
    // HEALTH & FALLBACK
    // ===========================================

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ===========================================
    // LOCAL DESIGN PREVIEW ROUTES
    // ===========================================
    if (isDesignPreviewEnabled()) {
        const redesignsDir = path.join(__dirname, 'redesigns');
        const selectorFile = path.join(redesignsDir, 'index.html');

        const sendConcept = (req, res) => {
            const concept = normalizeDesignConcept(req.params.concept);
            if (!concept) {
                return res.status(404).send('Design concept not found');
            }

            return res.sendFile(path.join(redesignsDir, concept, 'index.html'));
        };

        app.get('/__design', (req, res) => {
            res.sendFile(selectorFile);
        });
        app.get('/__design/:concept', sendConcept);
        app.get('/__design/:concept/notes/:noteId', sendConcept);
    } else {
        app.get('/__design', (req, res) => {
            res.status(404).send('Design preview is disabled');
        });
        app.get('/__design/*', (req, res) => {
            res.status(404).send('Design preview is disabled');
        });
    }

    app.get('/about', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'about.html'));
    });

    app.get('/feedback', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'feedback.html'));
    });

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });

    // CORS errors and fallback error handler
    app.use((err, req, res, next) => {
        if (err && err.message === 'CORS origin denied') {
            return res.status(403).json({ error: 'Origin not allowed' });
        }

        console.error('Unhandled server error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

function startServer() {
    const app = createApp();
    const PORT = process.env.PORT || 3000;
    const HOST = '0.0.0.0';

    const server = app.listen(PORT, HOST, () => {
        console.log(`Obsidian Notes Publisher listening on http://${HOST}:${PORT}`);
    });

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createApp,
    startServer,
    ensureAnonymousSession,
    applySecurityHeaders,
    createInMemoryRateLimiter
};
