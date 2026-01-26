/**
 * Obsidian Notes Publisher - Live Server V2
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

// Import modules
const { fetchNotes, clearCache, getAttachment } = require('./lib/drive');
const { 
    getGoogleAuthUrl, 
    handleGoogleCallback, 
    logoutUser, 
    authMiddleware, 
    requireAuth, 
    requireAdmin,
    requireModerator,
    getAllUsers,
    setUserRole,
    blockUser,
    unblockUser,
    isOAuthConfigured
} = require('./lib/oauth');
const { createComment, getCommentsForNote, updateComment, deleteComment, threadComments } = require('./lib/comments');
const { recordPageView, updateTimeSpent, getDashboardStats, saveReadingPosition, getReadingHistory } = require('./lib/analytics');
const { statements, db } = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

// Serve static files from dist folder
app.use(express.static(path.join(__dirname, 'dist')));

// ===========================================
// AUTH ROUTES (OAuth)
// ===========================================

// Check OAuth configuration status
app.get('/api/auth/config', (req, res) => {
    res.json({ 
        googleEnabled: isOAuthConfigured(),
        appleEnabled: false // Not implemented yet
    });
});

// Start Google OAuth flow
app.get('/auth/google', (req, res) => {
    try {
        if (!isOAuthConfigured()) {
            return res.status(503).json({ error: 'Google OAuth not configured' });
        }
        const authUrl = getGoogleAuthUrl();
        res.redirect(authUrl);
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.redirect('/?error=oauth_failed');
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
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        // Redirect to home page
        res.redirect('/');
    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('/?error=oauth_failed');
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

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, (req, res) => {
    try {
        const users = getAllUsers();
        res.json({ users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Update user role (admin only)
app.post('/api/admin/users/:userId/role', requireAdmin, (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        setUserRole(userId, role);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(400).json({ error: error.message });
    }
});

// Block user (admin only)
app.post('/api/admin/users/:userId/block', requireAdmin, (req, res) => {
    try {
        const { userId } = req.params;

        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot block yourself' });
        }

        blockUser(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error blocking user:', error);
        res.status(400).json({ error: error.message });
    }
});

// Unblock user (admin only)
app.post('/api/admin/users/:userId/unblock', requireAdmin, (req, res) => {
    try {
        const { userId } = req.params;
        unblockUser(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error unblocking user:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get all feedback (admin only)
app.get('/api/admin/feedback', requireAdmin, (req, res) => {
    try {
        const feedback = statements.getAllFeedback.all();
        res.json({ feedback });
    } catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

// Mark feedback as read (admin only)
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

// API: Get all notes
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

// API: Get single note by ID
app.get('/api/notes/:noteId', async (req, res) => {
    try {
        const data = await fetchNotes();
        const note = data.notes.find(n => n.id === req.params.noteId);

        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }

        // Record page view
        const viewId = recordPageView(note.id, req.user?.id, req.cookies?.session_id);

        res.json({ note, viewId });
    } catch (error) {
        console.error('Error fetching note:', error);
        res.status(500).json({ error: 'Failed to fetch note' });
    }
});

// API: Get search index
app.get('/api/search', async (req, res) => {
    try {
        const data = await fetchNotes();
        res.json(data.searchIndex);
    } catch (error) {
        console.error('Error fetching search index:', error);
        res.status(500).json({ error: 'Failed to fetch search index' });
    }
});

// API: Refresh cache
app.post('/api/refresh', (req, res) => {
    clearCache();
    res.json({ success: true, message: 'Cache cleared' });
});

// API: Get attachment
app.get('/api/attachment/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const { data, mimeType } = await getAttachment(decodeURIComponent(filename));
        res.set('Content-Type', mimeType);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(data);
    } catch (error) {
        console.error('Error fetching attachment:', error);
        res.status(404).json({ error: 'Attachment not found' });
    }
});

// ===========================================
// COMMENTS ROUTES
// ===========================================

// Get comments for a note
app.get('/api/notes/:noteId/comments', (req, res) => {
    try {
        const comments = getCommentsForNote(req.params.noteId, req.user?.id);
        const threaded = threadComments(comments);
        res.json({ comments: threaded });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// Add comment (requires auth)
app.post('/api/notes/:noteId/comments', requireAuth, (req, res) => {
    try {
        const { content, isPublic, parentId } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content required' });
        }

        const comment = createComment(
            req.params.noteId,
            req.user.id,
            content,
            isPublic,
            parentId
        );

        res.status(201).json({ comment });
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(400).json({ error: error.message });
    }
});

// Update comment (requires auth)
app.put('/api/comments/:commentId', requireAuth, (req, res) => {
    try {
        const { content, isPublic } = req.body;
        updateComment(req.params.commentId, req.user.id, content, isPublic);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(400).json({ error: error.message });
    }
});

// Delete comment (requires auth)
app.delete('/api/comments/:commentId', requireAuth, (req, res) => {
    try {
        deleteComment(req.params.commentId, req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(400).json({ error: error.message });
    }
});

// ===========================================
// ANALYTICS ROUTES
// ===========================================

// Record time spent on page
app.post('/api/analytics/time', (req, res) => {
    try {
        const { viewId, seconds } = req.body;
        if (viewId && seconds) {
            updateTimeSpent(viewId, seconds);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to record time' });
    }
});

// Get dashboard stats (requires auth)
app.get('/api/analytics/dashboard', requireAuth, (req, res) => {
    try {
        const stats = getDashboardStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Save reading position (requires auth)
app.post('/api/reading/position', requireAuth, (req, res) => {
    try {
        const { noteId, scrollPosition } = req.body;
        saveReadingPosition(req.user.id, noteId, scrollPosition);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save position' });
    }
});

// Get reading history (requires auth)
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

// Get user settings
app.get('/api/settings', requireAuth, (req, res) => {
    try {
        const result = statements.getSettings.get(req.user.id);
        const settings = result ? JSON.parse(result.settings_json) : {};
        res.json({ settings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Save user settings
app.post('/api/settings', requireAuth, (req, res) => {
    try {
        const { settings } = req.body;
        statements.upsertSettings.run(req.user.id, JSON.stringify(settings));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// ===========================================
// SHARE ROUTES
// ===========================================

// Generate share link
app.get('/api/share/:noteId', async (req, res) => {
    try {
        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const shareUrl = `${baseUrl}/notes/${req.params.noteId}`;
        res.json({ shareUrl });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate share link' });
    }
});

// ===========================================
// FEEDBACK ROUTES
// ===========================================

// Submit feedback
app.post('/api/feedback', (req, res) => {
    try {
        const { type, email, message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const id = require('uuid').v4();
        const userId = req.user?.id || null;
        const feedbackEmail = email || req.user?.email || null;

        statements.createFeedback.run(id, userId, feedbackEmail, type || 'other', message.trim());

        console.log(`📬 New feedback received: ${type} from ${feedbackEmail || 'anonymous'}`);

        res.status(201).json({ success: true, message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// ===========================================
// HEALTH & FALLBACK
// ===========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static pages - serve before SPA fallback
app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'about.html'));
});

app.get('/feedback', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'feedback.html'));
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server - bind to 0.0.0.0 for cloud deployment
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 Obsidian Notes Publisher V2                       ║
║                                                        ║
║   Server running at: http://${HOST}:${PORT}             ║
║                                                        ║
║   Features:                                            ║
║   ✓ Google Drive sync                                  ║
║   ✓ User authentication                                ║
║   ✓ Comments (public/private)                          ║
║   ✓ Analytics & insights                               ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
