/**
 * Obsidian Notes Publisher - Live Server V3
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const {
    fetchNotes,
    fetchVaultNotes,
    syncVault,
    syncAllVaults,
    clearCache,
    getAttachment,
    resolveNoteId
} = require('./lib/drive');
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
    canModerate,
    isOAuthConfigured
} = require('./lib/oauth');
const {
    createComment,
    getCommentsForNote,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    getCommentById,
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
const {
    resolveVaultByIdOrSlug,
    getDefaultVault,
    listVaultsForUser,
    getVaultRoleForUser,
    authorizeVaultRole
} = require('./lib/vaults');
const {
    canAccessNote,
    isNoteListable
} = require('./lib/publish');
const {
    isPushConfigured,
    getPublicVapidKey,
    upsertPushSubscription,
    removePushSubscription,
    notifyPublishedNotes,
    notifyCommentActivity,
    sendPayloadToAll
} = require('./lib/push');

const SESSION_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const JSON_BODY_LIMIT = '250kb';
const DESIGN_CONCEPTS = new Set(['concept-01', 'concept-02', 'concept-03', 'concept-04', 'concept-05']);

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function isDesignPreviewEnabled() {
    return !isProduction() && process.env.DESIGN_PREVIEW === '1';
}

function featureFlag(name, fallback = true) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return fallback;
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

function buildFolderTreeFromNotes(notes) {
    const tree = { name: 'root', children: [], notes: [] };
    const folders = new Map();
    folders.set('', tree);

    const ensureFolder = (folderPath) => {
        if (!folderPath) return tree;

        const parts = folderPath.split('/');
        let current = '';
        let parent = '';

        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!folders.has(current)) {
                const node = { name: part, path: current, children: [], notes: [] };
                folders.set(current, node);
                const parentNode = folders.get(parent || '');
                parentNode.children.push(node);
            }
            parent = current;
        }

        return folders.get(current);
    };

    for (const note of notes) {
        const node = ensureFolder(note.folder || '');
        node.notes.push({ id: note.id, title: note.title });
    }

    return tree;
}

function getVaultRole(reqUser, vault) {
    if (!vault) return null;
    if (reqUser?.role === 'admin') return 'owner';
    return getVaultRoleForUser(reqUser, vault.id);
}

function filterNotesByVisibility(notes, reqUser, vault, { listedOnly = false } = {}) {
    const vaultRole = getVaultRole(reqUser, vault);

    return notes.filter((note) => {
        const publishState = note.publishState || null;
        if (!canAccessNote(publishState, reqUser, vaultRole)) {
            return false;
        }

        if (listedOnly) {
            return isNoteListable(publishState, reqUser, vaultRole);
        }

        return true;
    });
}

function getCanonicalNoteId(data, noteId, vault) {
    const canonicalId = resolveNoteId(noteId, vault?.id || null);
    const note = data.notes.find((n) => n.id === canonicalId || n.legacyId === noteId);
    return { canonicalId, note };
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

function parseSearchQuery(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) return { terms: [], filters: {} };

    const filters = {};
    const terms = [];

    for (const token of query.split(/\s+/)) {
        const match = token.match(/^([a-zA-Z]+):(.+)$/);
        if (!match) {
            terms.push(token.toLowerCase());
            continue;
        }

        const key = match[1].toLowerCase();
        const value = match[2].toLowerCase();

        if (['tag', 'folder', 'vault', 'author', 'is'].includes(key)) {
            if (!filters[key]) filters[key] = [];
            filters[key].push(value);
        } else {
            terms.push(token.toLowerCase());
        }
    }

    return { terms, filters };
}

function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix = Array.from({ length: b.length + 1 }, () => []);

    for (let i = 0; i <= b.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i += 1) {
        for (let j = 1; j <= a.length; j += 1) {
            const cost = a[j - 1] === b[i - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[b.length][a.length];
}

function fuzzyMatches(text, term) {
    const cleanText = String(text || '').toLowerCase();
    const cleanTerm = String(term || '').toLowerCase();

    if (!cleanTerm || cleanTerm.length < 4) return false;

    const words = cleanText.split(/\W+/).filter(Boolean);
    let threshold = 0;
    if (cleanTerm.length >= 4 && cleanTerm.length <= 6) threshold = 1;
    if (cleanTerm.length >= 7) threshold = 2;
    if (threshold === 0) return false;

    return words.some((word) => {
        if (Math.abs(word.length - cleanTerm.length) > threshold) return false;
        return levenshteinDistance(word, cleanTerm) <= threshold;
    });
}

function scoreSearchEntry(entry, terms) {
    const title = String(entry.title || '').toLowerCase();
    const path = String(entry.path || '').toLowerCase();
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const content = String(entry.content || '').toLowerCase();

    let score = 0;

    for (const term of terms) {
        const clean = term.toLowerCase();
        if (!clean) continue;

        if (title === clean) {
            score += 40;
            continue;
        }

        if (title.startsWith(clean)) {
            score += 25;
        }

        if (title.includes(clean)) {
            score += 18;
        }

        if (tags.some((tag) => String(tag).toLowerCase().includes(clean))) {
            score += 15;
        }

        const frontmatterText = JSON.stringify(entry.frontmatter || {}).toLowerCase();
        if (frontmatterText.includes(clean)) {
            score += 10;
        }

        if (path.includes(clean)) {
            score += 8;
        }

        const contentMatches = (content.match(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        if (contentMatches > 0) {
            score += Math.min(20, contentMatches * 2);
        } else if (fuzzyMatches(`${title} ${tags.join(' ')} ${content}`, clean)) {
            score += 4;
        }
    }

    return score;
}

function applySearchFilters(entries, filters, vault) {
    let filtered = entries;

    if (filters.tag?.length) {
        filtered = filtered.filter((entry) => {
            const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).toLowerCase()) : [];
            return filters.tag.every((wanted) => tags.includes(wanted));
        });
    }

    if (filters.folder?.length) {
        filtered = filtered.filter((entry) => {
            const folder = String(entry.folder || '').toLowerCase();
            return filters.folder.every((value) => folder.includes(value));
        });
    }

    if (filters.vault?.length) {
        filtered = filtered.filter((entry) => {
            const vaultSlug = String(entry.vaultSlug || vault.slug || '').toLowerCase();
            const vaultId = String(entry.vaultId || vault.id || '').toLowerCase();
            return filters.vault.some((value) => value === vaultSlug || value === vaultId);
        });
    }

    if (filters.is?.length) {
        filtered = filtered.filter((entry) => {
            return filters.is.every((value) => {
                if (value === 'draft') return !!entry.isDraft;
                if (value === 'unlisted') return !!entry.isUnlisted;
                return true;
            });
        });
    }

    return filtered;
}

function runSearch(entries, query, vault) {
    if (!query || !query.trim()) {
        return entries.slice(0, 200);
    }

    const parsed = parseSearchQuery(query);
    const filtered = applySearchFilters(entries, parsed.filters, vault);

    const scored = filtered
        .map((entry) => ({
            ...entry,
            score: scoreSearchEntry(entry, parsed.terms.length ? parsed.terms : [query.toLowerCase()])
        }))
        .filter((entry) => entry.score > 0 || parsed.terms.length === 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);

    return scored;
}

async function getVaultDataOr404(vaultRef) {
    const vault = resolveVaultByIdOrSlug(vaultRef) || getDefaultVault();
    if (!vault) {
        return { vault: null, data: null };
    }

    const data = await fetchVaultNotes(vault.id);
    return { vault, data };
}

function createApp() {
    const app = express();

    app.set('trust proxy', 1);

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

    app.use(express.static(path.join(__dirname, 'dist')));

    // ===========================================
    // AUTH ROUTES
    // ===========================================

    app.get('/api/auth/config', (req, res) => {
        res.json({
            googleEnabled: isOAuthConfigured(),
            appleEnabled: false,
            pushEnabled: isPushConfigured(),
            vapidPublicKey: getPublicVapidKey()
        });
    });

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

    app.post('/api/auth/logout', (req, res) => {
        const token = req.cookies?.session_token;
        if (token) logoutUser(token);
        res.clearCookie('session_token');
        res.json({ success: true });
    });

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
    // VAULT ROUTES
    // ===========================================

    app.get('/api/vaults', (req, res) => {
        try {
            const vaults = listVaultsForUser(req.user).map((vault) => ({
                id: vault.id,
                slug: vault.slug,
                name: vault.name,
                isDefault: vault.is_default === 1,
                role: vault.user_role || (req.user?.role === 'admin' ? 'owner' : null)
            }));

            res.json({ vaults });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch vaults' });
        }
    });

    app.get('/api/vaults/:vaultId/notes', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const data = await fetchVaultNotes(req.vault.id);
            const visibleNotes = filterNotesByVisibility(data.notes, req.user, req.vault, { listedOnly: true });

            res.json({
                siteName: data.siteName,
                vault: {
                    id: req.vault.id,
                    slug: req.vault.slug,
                    name: req.vault.name
                },
                notes: visibleNotes,
                folderTree: buildFolderTreeFromNotes(visibleNotes)
            });
        } catch (error) {
            console.error('Error fetching vault notes:', error);
            res.status(500).json({ error: 'Failed to fetch notes' });
        }
    });

    app.get('/api/vaults/:vaultId/notes/:noteId', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const data = await fetchVaultNotes(req.vault.id);
            const { note, canonicalId } = getCanonicalNoteId(data, req.params.noteId, req.vault);

            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const vaultRole = getVaultRole(req.user, req.vault);
            if (!canAccessNote(note.publishState, req.user, vaultRole)) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const viewId = recordPageView(canonicalId, req.user?.id || null, req.sessionId || null);
            return res.json({ note, viewId, canonicalId });
        } catch (error) {
            console.error('Error fetching vault note:', error);
            return res.status(500).json({ error: 'Failed to fetch note' });
        }
    });

    app.get('/api/vaults/:vaultId/search', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const data = await fetchVaultNotes(req.vault.id);
            const visibleNoteIds = new Set(
                filterNotesByVisibility(data.notes, req.user, req.vault, { listedOnly: true }).map((note) => note.id)
            );

            const visibleEntries = data.searchIndex.filter((entry) => visibleNoteIds.has(entry.id));
            const query = asTrimmedString(req.query?.q) || '';
            const results = runSearch(visibleEntries, query, req.vault);

            res.json(results);
        } catch (error) {
            console.error('Error searching vault:', error);
            res.status(500).json({ error: 'Failed to search notes' });
        }
    });

    app.get('/api/vaults/:vaultId/tags', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const data = await fetchVaultNotes(req.vault.id);
            const visibleNotes = filterNotesByVisibility(data.notes, req.user, req.vault, { listedOnly: true });

            const counts = new Map();
            for (const note of visibleNotes) {
                for (const tag of note.tags || []) {
                    const normalized = String(tag).toLowerCase();
                    counts.set(normalized, (counts.get(normalized) || 0) + 1);
                }
            }

            const tags = Array.from(counts.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => a.tag.localeCompare(b.tag));

            res.json({ tags });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch tags' });
        }
    });

    app.get('/api/vaults/:vaultId/tags/:tag', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const wanted = String(req.params.tag || '').toLowerCase();
            const data = await fetchVaultNotes(req.vault.id);
            const visibleNotes = filterNotesByVisibility(data.notes, req.user, req.vault, { listedOnly: true })
                .filter((note) => (note.tags || []).map((t) => String(t).toLowerCase()).includes(wanted));

            res.json({ tag: wanted, notes: visibleNotes });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch tag notes' });
        }
    });

    app.get('/api/vaults/:vaultId/meta/:field/:value', authorizeVaultRole('viewer'), async (req, res) => {
        try {
            const field = String(req.params.field || '').trim();
            const value = String(req.params.value || '').trim().toLowerCase();

            const data = await fetchVaultNotes(req.vault.id);
            const visibleNotes = filterNotesByVisibility(data.notes, req.user, req.vault, { listedOnly: true })
                .filter((note) => {
                    const raw = note.frontmatter?.[field];
                    if (Array.isArray(raw)) {
                        return raw.some((item) => String(item).toLowerCase() === value);
                    }
                    if (raw === null || raw === undefined) return false;
                    return String(raw).toLowerCase() === value;
                });

            res.json({ field, value, notes: visibleNotes });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch metadata view' });
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
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/admin/users/:userId/unblock', requireAdmin, (req, res) => {
        try {
            unblockUser(req.params.userId);
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/admin/feedback', requireAdmin, (req, res) => {
        try {
            const feedback = statements.getAllFeedback.all();
            res.json({ feedback });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch feedback' });
        }
    });

    app.post('/api/admin/feedback/:feedbackId/read', requireAdmin, (req, res) => {
        try {
            statements.markFeedbackRead.run(req.params.feedbackId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update feedback' });
        }
    });

    app.post('/api/admin/sync', requireAdmin, async (req, res) => {
        try {
            const vaultRef = asTrimmedString(req.body?.vaultId) || asTrimmedString(req.query?.vaultId) || null;
            const force = parseBoolean(req.body?.force, false);

            if (vaultRef) {
                const vault = resolveVaultByIdOrSlug(vaultRef);
                if (!vault) {
                    return res.status(404).json({ error: 'Vault not found' });
                }

                const result = await syncVault(vault.id, { force });
                await notifyPublishedNotes(vault, result.newlyPublished || []);
                return res.json({
                    success: true,
                    mode: 'single',
                    vault: { id: vault.id, slug: vault.slug, name: vault.name },
                    stats: result.syncStats,
                    newlyPublished: (result.newlyPublished || []).length
                });
            }

            const all = await syncAllVaults({ force });
            let publishedCount = 0;

            for (const item of all) {
                // eslint-disable-next-line no-await-in-loop
                await notifyPublishedNotes(item.vault, item.result.newlyPublished || []);
                publishedCount += (item.result.newlyPublished || []).length;
            }

            return res.json({
                success: true,
                mode: 'all',
                results: all.map((item) => ({
                    vault: { id: item.vault.id, slug: item.vault.slug, name: item.vault.name },
                    stats: item.result.syncStats,
                    newlyPublished: (item.result.newlyPublished || []).length
                })),
                publishedCount
            });
        } catch (error) {
            console.error('Admin sync failed:', error);
            return res.status(500).json({ error: 'Failed to run sync', message: error.message });
        }
    });

    // ===========================================
    // DEFAULT-VAULT ALIAS ROUTES
    // ===========================================

    app.get('/api/notes', async (req, res) => {
        try {
            const defaultVault = getDefaultVault();
            if (!defaultVault) {
                return res.status(503).json({ error: 'Default vault is not configured' });
            }

            const data = await fetchNotes();
            const visibleNotes = filterNotesByVisibility(data.notes, req.user, defaultVault, { listedOnly: true });

            res.json({
                siteName: data.siteName,
                notes: visibleNotes,
                folderTree: buildFolderTreeFromNotes(visibleNotes),
                vault: {
                    id: defaultVault.id,
                    slug: defaultVault.slug,
                    name: defaultVault.name
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch notes', message: error.message });
        }
    });

    app.get('/api/notes/:noteId', async (req, res) => {
        try {
            const defaultVault = getDefaultVault();
            if (!defaultVault) {
                return res.status(503).json({ error: 'Default vault is not configured' });
            }

            const data = await fetchNotes();
            const { note, canonicalId } = getCanonicalNoteId(data, req.params.noteId, defaultVault);

            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const vaultRole = getVaultRole(req.user, defaultVault);
            if (!canAccessNote(note.publishState, req.user, vaultRole)) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const viewId = recordPageView(canonicalId, req.user?.id || null, req.sessionId || null);
            return res.json({ note, viewId, canonicalId });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch note' });
        }
    });

    app.get('/api/search', async (req, res) => {
        try {
            const defaultVault = getDefaultVault();
            if (!defaultVault) {
                return res.status(503).json({ error: 'Default vault is not configured' });
            }

            const data = await fetchNotes();
            const visibleNoteIds = new Set(
                filterNotesByVisibility(data.notes, req.user, defaultVault, { listedOnly: true }).map((note) => note.id)
            );

            const visibleEntries = data.searchIndex.filter((entry) => visibleNoteIds.has(entry.id));
            const query = asTrimmedString(req.query?.q) || '';

            if (!query) {
                return res.json(visibleEntries);
            }

            return res.json(runSearch(visibleEntries, query, defaultVault));
        } catch (error) {
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
            const vaultRef = asTrimmedString(req.query?.vaultId) || null;
            const { data, mimeType } = await getAttachment(decodeURIComponent(filename), vaultRef);
            res.set('Content-Type', mimeType);
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(data);
        } catch (error) {
            res.status(404).json({ error: 'Attachment not found' });
        }
    });

    // ===========================================
    // COMMENTS ROUTES
    // ===========================================

    async function resolveNoteForComments(vaultRef, noteId) {
        const { vault, data } = await getVaultDataOr404(vaultRef);
        if (!vault || !data) return { vault: null, note: null, canonicalId: null, data: null };

        const { note, canonicalId } = getCanonicalNoteId(data, noteId, vault);
        return { vault, note, canonicalId, data };
    }

    const handleGetComments = async (req, res, vaultRef) => {
        try {
            const { vault, note, canonicalId } = await resolveNoteForComments(vaultRef, req.params.noteId);
            if (!vault || !note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const vaultRole = getVaultRole(req.user, vault);
            if (!canAccessNote(note.publishState, req.user, vaultRole)) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const currentUser = req.user
                ? { id: req.user.id, role: req.user.role, canModerate: canModerate(req.user) }
                : null;

            const primary = getCommentsForNote(canonicalId, currentUser);
            const withLegacy = note.legacyId && note.legacyId !== canonicalId
                ? getCommentsForNote(note.legacyId, currentUser)
                : [];

            const threaded = threadComments(mergeComments(primary, withLegacy));
            return res.json({ comments: threaded, canonicalId });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch comments' });
        }
    };

    const handleCreateComment = async (req, res, vaultRef) => {
        try {
            const { vault, note, canonicalId } = await resolveNoteForComments(vaultRef, req.params.noteId);
            if (!vault || !note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const vaultRole = getVaultRole(req.user, vault);
            if (!canAccessNote(note.publishState, req.user, vaultRole)) {
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
                parentId || null,
                {
                    selectionStart: req.body?.selectionStart,
                    selectionEnd: req.body?.selectionEnd,
                    selectionText: req.body?.selectionText
                }
            );

            let replyUserId = null;
            if (parentId) {
                const parent = getCommentById(parentId);
                replyUserId = parent?.user_id || null;
            }

            const actorDisplayName = req.user.displayName || req.user.email || 'Someone';
            await notifyCommentActivity({
                actorUserId: req.user.id,
                actorDisplayName,
                noteId: canonicalId,
                noteTitle: note.title,
                commentPreview: content.slice(0, 120),
                mentionUserIds: comment.mentionUserIds || [],
                replyUserId
            });

            return res.status(201).json({ comment });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    };

    app.get('/api/notes/:noteId/comments', (req, res) => handleGetComments(req, res, null));
    app.get('/api/vaults/:vaultId/notes/:noteId/comments', authorizeVaultRole('viewer'), (req, res) => {
        return handleGetComments(req, res, req.vault.id);
    });

    app.post('/api/notes/:noteId/comments', requireAuth, (req, res) => handleCreateComment(req, res, null));
    app.post('/api/vaults/:vaultId/notes/:noteId/comments', requireAuth, authorizeVaultRole('viewer'), (req, res) => {
        return handleCreateComment(req, res, req.vault.id);
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
            return res.status(400).json({ error: error.message });
        }
    });

    app.delete('/api/comments/:commentId', requireAuth, (req, res) => {
        try {
            deleteComment(req.params.commentId, req.user.id);
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/comments/:commentId/resolve', requireAuth, (req, res) => {
        try {
            resolveComment(req.params.commentId, {
                id: req.user.id,
                role: req.user.role,
                canModerate: canModerate(req.user)
            });
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/comments/:commentId/reopen', requireAuth, (req, res) => {
        try {
            reopenComment(req.params.commentId, {
                id: req.user.id,
                role: req.user.role,
                canModerate: canModerate(req.user)
            });
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/users/mentions', requireAuth, (req, res) => {
        try {
            const q = asTrimmedString(req.query?.q) || '';
            if (q.length < 2) {
                return res.json({ users: [] });
            }

            const pattern = `%${q.toLowerCase()}%`;
            const users = statements.searchUsersForMentions
                .all(pattern, pattern, pattern, q.toLowerCase(), q.toLowerCase(), 10)
                .map((user) => ({
                    id: user.id,
                    displayName: user.display_name || user.email.split('@')[0],
                    email: user.email
                }));

            return res.json({ users });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to lookup users' });
        }
    });

    // ===========================================
    // PUSH ROUTES
    // ===========================================

    app.post('/api/push/subscribe', requireAuth, (req, res) => {
        try {
            if (!isPushConfigured()) {
                return res.status(503).json({ error: 'Push notifications are not configured' });
            }

            upsertPushSubscription(req.user.id, req.body?.subscription);
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
        try {
            removePushSubscription(asTrimmedString(req.body?.endpoint));
            return res.json({ success: true });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/push/test', requireAdmin, async (req, res) => {
        try {
            if (!isPushConfigured()) {
                return res.status(503).json({ error: 'Push notifications are not configured' });
            }

            const result = await sendPayloadToAll({
                title: 'Clinical Vault test notification',
                body: `Triggered by ${req.user.displayName || req.user.email}`,
                url: '/'
            }, 'published');

            return res.json({ success: true, result });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to send test push' });
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
            res.status(500).json({ error: 'Failed to fetch analytics' });
        }
    });

    app.post('/api/reading/position', requireAuth, async (req, res) => {
        try {
            const noteId = asTrimmedString(req.body?.noteId);
            const scrollPosition = Number(req.body?.scrollPosition);
            if (!noteId) {
                return res.status(400).json({ error: 'noteId is required' });
            }

            const defaultVault = getDefaultVault();
            if (!defaultVault) {
                return res.status(503).json({ error: 'Default vault is not configured' });
            }

            const data = await fetchNotes();
            const { note, canonicalId } = getCanonicalNoteId(data, noteId, defaultVault);

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
            const defaultVault = getDefaultVault();
            if (!defaultVault) {
                return res.status(503).json({ error: 'Default vault is not configured' });
            }

            const data = await fetchNotes();
            const { note, canonicalId } = getCanonicalNoteId(data, req.params.noteId, defaultVault);
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            const vaultRole = getVaultRole(req.user, defaultVault);
            if (!canAccessNote(note.publishState, req.user, vaultRole)) {
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
            return res.status(500).json({ error: 'Failed to submit feedback' });
        }
    });

    // ===========================================
    // HEALTH & FALLBACK
    // ===========================================

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

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

    app.use((err, req, res, next) => {
        if (err && err.message === 'CORS origin denied') {
            return res.status(403).json({ error: 'Origin not allowed' });
        }

        console.error('Unhandled server error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

let syncIntervalHandle = null;
let syncInFlight = false;

async function runBackgroundSyncCycle() {
    if (syncInFlight) {
        return;
    }

    syncInFlight = true;
    const started = Date.now();

    try {
        const results = await syncAllVaults();
        let publishedCount = 0;

        for (const item of results) {
            // eslint-disable-next-line no-await-in-loop
            await notifyPublishedNotes(item.vault, item.result.newlyPublished || []);
            publishedCount += (item.result.newlyPublished || []).length;
        }

        console.log(JSON.stringify({
            event: 'sync-cycle',
            vaults: results.length,
            publishedCount,
            durationMs: Date.now() - started
        }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'sync-cycle-error',
            error: error.message,
            durationMs: Date.now() - started
        }));
    } finally {
        syncInFlight = false;
    }
}

function startServer() {
    const app = createApp();
    const PORT = process.env.PORT || 3000;
    const HOST = '0.0.0.0';

    const server = app.listen(PORT, HOST, () => {
        console.log(`Obsidian Notes Publisher listening on http://${HOST}:${PORT}`);
    });

    if (featureFlag('FEATURE_INCREMENTAL_SYNC', true)) {
        const intervalMs = Math.max(30, toInt(process.env.SYNC_INTERVAL_SECONDS, 180)) * 1000;
        syncIntervalHandle = setInterval(() => {
            runBackgroundSyncCycle().catch((error) => {
                console.error('Background sync cycle failed:', error.message);
            });
        }, intervalMs);
        syncIntervalHandle.unref();

        setTimeout(() => {
            runBackgroundSyncCycle().catch((error) => {
                console.error('Initial background sync failed:', error.message);
            });
        }, 1_500).unref();
    }

    server.on('close', () => {
        if (syncIntervalHandle) {
            clearInterval(syncIntervalHandle);
            syncIntervalHandle = null;
        }
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
    createInMemoryRateLimiter,
    runBackgroundSyncCycle
};
