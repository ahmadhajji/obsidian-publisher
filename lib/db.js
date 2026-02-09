/**
 * Database initialization and connection management
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database file path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'obsidian-publisher.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initializeDatabase() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema (multiple statements)
    db.exec(schema);

    console.log('✅ Database initialized');
}

// Run initialization
initializeDatabase();

// Prepared statements for common operations
const statements = {
    // Users
    createUser: db.prepare(`
        INSERT INTO users (id, email, password_hash, display_name)
        VALUES (?, ?, ?, ?)
    `),
    getUserByEmail: db.prepare(`
        SELECT * FROM users WHERE email = ?
    `),
    getUserById: db.prepare(`
        SELECT * FROM users WHERE id = ?
    `),

    // Sessions
    createSession: db.prepare(`
        INSERT INTO sessions (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
    `),
    getSessionByToken: db.prepare(`
        SELECT s.*, u.email, u.display_name 
        FROM sessions s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `),
    deleteSession: db.prepare(`
        DELETE FROM sessions WHERE token = ?
    `),
    deleteExpiredSessions: db.prepare(`
        DELETE FROM sessions WHERE expires_at <= datetime('now')
    `),

    // Comments
    createComment: db.prepare(`
        INSERT INTO comments (id, note_id, user_id, content, is_public, parent_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    getCommentsByNote: db.prepare(`
        SELECT c.*, u.display_name, u.email
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.note_id = ?
        ORDER BY c.created_at ASC
    `),
    getPublicCommentsByNote: db.prepare(`
        SELECT c.*, u.display_name, u.email
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.note_id = ? AND c.is_public = 1
        ORDER BY c.created_at ASC
    `),
    deleteComment: db.prepare(`
        DELETE FROM comments WHERE id = ? AND user_id = ?
    `),
    updateComment: db.prepare(`
        UPDATE comments SET content = ?, is_public = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
    `),

    // Analytics
    recordPageView: db.prepare(`
        INSERT INTO page_views (note_id, user_id, session_id)
        VALUES (?, ?, ?)
    `),
    getPageViewById: db.prepare(`
        SELECT id, note_id, user_id, session_id, time_spent_seconds
        FROM page_views
        WHERE id = ?
    `),
    updateTimeSpent: db.prepare(`
        UPDATE page_views
        SET time_spent_seconds = CASE
            WHEN ? > time_spent_seconds THEN ?
            ELSE time_spent_seconds
        END
        WHERE id = ?
    `),
    getTopNotes: db.prepare(`
        SELECT note_id, COUNT(*) as view_count
        FROM page_views
        GROUP BY note_id
        ORDER BY view_count DESC
        LIMIT ?
    `),
    getNoteStats: db.prepare(`
        SELECT 
            note_id,
            COUNT(*) as total_views,
            COUNT(DISTINCT user_id) as unique_users,
            AVG(time_spent_seconds) as avg_time_spent
        FROM page_views
        WHERE note_id = ?
        GROUP BY note_id
    `),

    // Reading history
    upsertReadingHistory: db.prepare(`
        INSERT INTO reading_history (user_id, note_id, last_read_at, scroll_position)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(user_id, note_id) DO UPDATE SET
            last_read_at = datetime('now'),
            scroll_position = excluded.scroll_position
    `),
    getReadingHistory: db.prepare(`
        SELECT * FROM reading_history
        WHERE user_id = ?
        ORDER BY last_read_at DESC
        LIMIT ?
    `),

    // User settings
    upsertSettings: db.prepare(`
        INSERT INTO user_settings (user_id, settings_json, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
            settings_json = excluded.settings_json,
            updated_at = datetime('now')
    `),
    getSettings: db.prepare(`
        SELECT settings_json FROM user_settings WHERE user_id = ?
    `),

    // Push subscriptions
    createPushSubscription: db.prepare(`
        INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
        VALUES (?, ?, ?, ?, ?)
    `),
    deletePushSubscription: db.prepare(`
        DELETE FROM push_subscriptions WHERE endpoint = ?
    `),
    getPushSubscriptions: db.prepare(`
        SELECT * FROM push_subscriptions
    `),

    // Feedback
    createFeedback: db.prepare(`
        INSERT INTO feedback (id, user_id, email, type, message)
        VALUES (?, ?, ?, ?, ?)
    `),
    getAllFeedback: db.prepare(`
        SELECT * FROM feedback ORDER BY created_at DESC
    `),
    markFeedbackRead: db.prepare(`
        UPDATE feedback SET is_read = 1 WHERE id = ?
    `)
};

// Clean up expired sessions periodically
const cleanupInterval = setInterval(() => {
    try {
        statements.deleteExpiredSessions.run();
    } catch (err) {
        console.error('Error cleaning expired sessions:', err);
    }
}, 60 * 60 * 1000); // Every hour
cleanupInterval.unref();

module.exports = {
    db,
    statements,
    cleanupInterval
};
