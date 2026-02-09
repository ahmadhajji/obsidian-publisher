/**
 * Analytics module - tracks views, reading time, and history
 */

const { statements, db } = require('./db');

const MAX_TIME_SPENT_SECONDS = 12 * 60 * 60;

/**
 * Record a page view
 */
function recordPageView(noteId, userId = null, sessionId = null) {
    const result = statements.recordPageView.run(noteId, userId, sessionId);
    return result.lastInsertRowid;
}

function normalizeSeconds(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) {
        return null;
    }

    return Math.min(Math.round(value), MAX_TIME_SPENT_SECONDS);
}

function isViewOwner(view, userId, sessionId) {
    if (view.user_id) {
        return Boolean(userId && view.user_id === userId);
    }

    return Boolean(sessionId && view.session_id && view.session_id === sessionId);
}

/**
 * Update time spent on a page
 */
function updateTimeSpent(viewId, seconds, viewer = {}) {
    const normalizedViewId = Number(viewId);
    if (!Number.isInteger(normalizedViewId) || normalizedViewId <= 0) {
        throw new Error('Invalid viewId');
    }

    const normalizedSeconds = normalizeSeconds(seconds);
    if (normalizedSeconds === null) {
        throw new Error('Invalid seconds');
    }

    const view = statements.getPageViewById.get(normalizedViewId);
    if (!view) {
        throw new Error('View not found');
    }

    if (!isViewOwner(view, viewer.userId || null, viewer.sessionId || null)) {
        throw new Error('Not authorized to update this view');
    }

    statements.updateTimeSpent.run(normalizedSeconds, normalizedSeconds, normalizedViewId);
}

/**
 * Get top viewed notes
 */
function getTopNotes(limit = 10) {
    return statements.getTopNotes.all(limit);
}

/**
 * Get stats for a specific note
 */
function getNoteStats(noteId) {
    return statements.getNoteStats.get(noteId) || {
        note_id: noteId,
        total_views: 0,
        unique_users: 0,
        avg_time_spent: 0
    };
}

/**
 * Get overall analytics dashboard data
 */
function getDashboardStats() {
    // Total views
    const totalViews = db.prepare(`
        SELECT COUNT(*) as count FROM page_views
    `).get().count;

    // Views today
    const viewsToday = db.prepare(`
        SELECT COUNT(*) as count FROM page_views
        WHERE date(viewed_at) = date('now')
    `).get().count;

    // Views this week
    const viewsThisWeek = db.prepare(`
        SELECT COUNT(*) as count FROM page_views
        WHERE viewed_at >= date('now', '-7 days')
    `).get().count;

    // Unique visitors
    const uniqueVisitors = db.prepare(`
        SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) as count
        FROM page_views
    `).get().count;

    // Average time spent
    const avgTimeSpent = db.prepare(`
        SELECT AVG(time_spent_seconds) as avg FROM page_views
        WHERE time_spent_seconds > 0
    `).get().avg || 0;

    // Views by day (last 30 days)
    const viewsByDay = db.prepare(`
        SELECT date(viewed_at) as date, COUNT(*) as views
        FROM page_views
        WHERE viewed_at >= date('now', '-30 days')
        GROUP BY date(viewed_at)
        ORDER BY date ASC
    `).all();

    // Top notes
    const topNotes = getTopNotes(10);

    return {
        totalViews,
        viewsToday,
        viewsThisWeek,
        uniqueVisitors,
        avgTimeSpent: Math.round(avgTimeSpent),
        viewsByDay,
        topNotes
    };
}

/**
 * Save reading position
 */
function saveReadingPosition(userId, noteId, scrollPosition) {
    statements.upsertReadingHistory.run(userId, noteId, scrollPosition);
}

/**
 * Get user's reading history
 */
function getReadingHistory(userId, limit = 20) {
    return statements.getReadingHistory.all(userId, limit);
}

/**
 * Get continue reading suggestions
 */
function getContinueReading(userId) {
    const history = getReadingHistory(userId, 5);
    return history.filter((h) => h.scroll_position > 0 && h.scroll_position < 0.9);
}

module.exports = {
    recordPageView,
    updateTimeSpent,
    getTopNotes,
    getNoteStats,
    getDashboardStats,
    saveReadingPosition,
    getReadingHistory,
    getContinueReading
};
