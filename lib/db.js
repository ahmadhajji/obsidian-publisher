/**
 * Database initialization and connection management
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
// eslint-disable-next-line no-unused-expressions
 db.pragma('foreign_keys = ON');

function initializeLegacySchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
}

function ensureMigrationsTable() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function runMigrations() {
    ensureMigrationsTable();

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        return;
    }

    const files = fs.readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));

    const getMigration = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
    const insertMigration = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

    for (const file of files) {
        const alreadyApplied = getMigration.get(file);
        if (alreadyApplied) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        const apply = db.transaction(() => {
            db.exec(sql);
            insertMigration.run(file);
        });
        apply();
        console.log(`✅ Applied migration: ${file}`);
    }
}

function migrateLegacyUsersSchema() {
    const columns = db.prepare('PRAGMA table_info(users)').all();
    if (!columns.length) return;

    const existingColumns = new Set(columns.map((column) => column.name));
    const columnMigrations = [
        { name: 'avatar_url', sql: 'ALTER TABLE users ADD COLUMN avatar_url TEXT' },
        { name: 'oauth_provider', sql: 'ALTER TABLE users ADD COLUMN oauth_provider TEXT' },
        { name: 'oauth_id', sql: 'ALTER TABLE users ADD COLUMN oauth_id TEXT' },
        { name: 'role', sql: 'ALTER TABLE users ADD COLUMN role TEXT DEFAULT \'member\'' },
        { name: 'is_blocked', sql: 'ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0' }
    ];

    const applied = [];
    for (const migration of columnMigrations) {
        if (existingColumns.has(migration.name)) continue;
        db.exec(migration.sql);
        applied.push(migration.name);
    }

    if (applied.length > 0) {
        console.log(`✅ Applied users schema migration: ${applied.join(', ')}`);
    }
}

function migrateLegacyCommentsSchema() {
    const columns = db.prepare('PRAGMA table_info(comments)').all();
    if (!columns.length) return;

    const existingColumns = new Set(columns.map((column) => column.name));
    const migrations = [
        { name: 'selection_start', sql: 'ALTER TABLE comments ADD COLUMN selection_start INTEGER' },
        { name: 'selection_end', sql: 'ALTER TABLE comments ADD COLUMN selection_end INTEGER' },
        { name: 'selection_text', sql: 'ALTER TABLE comments ADD COLUMN selection_text TEXT' },
        { name: 'is_resolved', sql: 'ALTER TABLE comments ADD COLUMN is_resolved INTEGER DEFAULT 0' }
    ];

    const applied = [];
    for (const migration of migrations) {
        if (existingColumns.has(migration.name)) continue;
        db.exec(migration.sql);
        applied.push(migration.name);
    }

    if (applied.length > 0) {
        console.log(`✅ Applied comments schema migration: ${applied.join(', ')}`);
    }
}

function bootstrapDefaultVault() {
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!driveFolderId) {
        return;
    }

    const siteName = (process.env.SITE_NAME || 'Obsidian Notes').trim();
    const attachmentsFolderId = process.env.ATTACHMENTS_FOLDER_ID || null;

    const tx = db.transaction(() => {
        const existingDefault = db.prepare(`
            SELECT * FROM vaults
            WHERE is_default = 1 OR slug = 'default'
            ORDER BY is_default DESC, created_at ASC
            LIMIT 1
        `).get();

        let vaultId = existingDefault?.id;
        if (!existingDefault) {
            vaultId = uuidv4();
            db.prepare(`
                INSERT INTO vaults (
                    id, slug, name, drive_folder_id, attachments_folder_id, is_default
                ) VALUES (?, 'default', ?, ?, ?, 1)
            `).run(vaultId, siteName, driveFolderId, attachmentsFolderId);
        } else {
            db.prepare(`
                UPDATE vaults
                SET name = ?, drive_folder_id = ?, attachments_folder_id = ?, is_default = 1, updated_at = datetime('now')
                WHERE id = ?
            `).run(siteName, driveFolderId, attachmentsFolderId, existingDefault.id);
            vaultId = existingDefault.id;
        }

        // Ensure only one default vault.
        db.prepare('UPDATE vaults SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(vaultId);

        const users = db.prepare('SELECT id, role FROM users').all();
        const upsertRole = db.prepare(`
            INSERT INTO user_vault_roles (user_id, vault_id, role)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, vault_id) DO UPDATE SET
                role = excluded.role,
                updated_at = datetime('now')
        `);

        for (const user of users) {
            const normalizedRole = user.role === 'admin' ? 'owner' : 'viewer';
            upsertRole.run(user.id, vaultId, normalizedRole);
        }
    });

    tx();
}

function initializeDatabase() {
    initializeLegacySchema();
    migrateLegacyUsersSchema();
    migrateLegacyCommentsSchema();
    runMigrations();
    bootstrapDefaultVault();
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
    searchUsersForMentions: db.prepare(`
        SELECT id, email, display_name, role, is_blocked
        FROM users
        WHERE is_blocked = 0
          AND (
              lower(COALESCE(display_name, '')) LIKE lower(?)
              OR lower(email) LIKE lower(?)
              OR lower(
                    CASE
                        WHEN instr(email, '@') > 0 THEN substr(email, 1, instr(email, '@') - 1)
                        ELSE email
                    END
                 ) LIKE lower(?)
          )
        ORDER BY
            CASE WHEN lower(COALESCE(display_name, '')) = lower(?) THEN 0 ELSE 1 END,
            CASE WHEN lower(email) = lower(?) THEN 0 ELSE 1 END,
            created_at ASC
        LIMIT ?
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

    // Vaults
    createVault: db.prepare(`
        INSERT INTO vaults (id, slug, name, drive_folder_id, attachments_folder_id, is_default)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    getVaultById: db.prepare(`
        SELECT * FROM vaults WHERE id = ?
    `),
    getVaultBySlug: db.prepare(`
        SELECT * FROM vaults WHERE slug = ?
    `),
    getDefaultVault: db.prepare(`
        SELECT * FROM vaults WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1
    `),
    listAllVaults: db.prepare(`
        SELECT * FROM vaults ORDER BY is_default DESC, name ASC
    `),
    listVaultsForUser: db.prepare(`
        SELECT v.*, uvr.role as user_role
        FROM vaults v
        LEFT JOIN user_vault_roles uvr
          ON uvr.vault_id = v.id AND uvr.user_id = ?
        WHERE v.is_default = 1 OR uvr.user_id IS NOT NULL
        ORDER BY v.is_default DESC, v.name ASC
    `),
    getUserVaultRole: db.prepare(`
        SELECT role
        FROM user_vault_roles
        WHERE user_id = ? AND vault_id = ?
    `),
    upsertUserVaultRole: db.prepare(`
        INSERT INTO user_vault_roles (user_id, vault_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, vault_id) DO UPDATE SET
            role = excluded.role,
            updated_at = datetime('now')
    `),
    updateVaultSyncState: db.prepare(`
        UPDATE vaults
        SET link_map_signature = ?, last_sync_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
    `),

    // Note registry/cache/publish state
    getActiveNoteRegistryByVault: db.prepare(`
        SELECT *
        FROM note_registry
        WHERE vault_id = ? AND deleted_at IS NULL
        ORDER BY path ASC
    `),
    getNoteRegistryByVault: db.prepare(`
        SELECT *
        FROM note_registry
        WHERE vault_id = ?
        ORDER BY path ASC
    `),
    getNoteRegistryByVaultAndDrive: db.prepare(`
        SELECT *
        FROM note_registry
        WHERE vault_id = ? AND drive_id = ?
        LIMIT 1
    `),
    getNoteRegistryByStableId: db.prepare(`
        SELECT *
        FROM note_registry
        WHERE vault_id = ? AND stable_note_id = ?
        LIMIT 1
    `),
    upsertNoteRegistry: db.prepare(`
        INSERT INTO note_registry (
            id, vault_id, drive_id, stable_note_id, legacy_id, path, title, modified_time, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
        ON CONFLICT(vault_id, drive_id) DO UPDATE SET
            stable_note_id = excluded.stable_note_id,
            legacy_id = excluded.legacy_id,
            path = excluded.path,
            title = excluded.title,
            modified_time = excluded.modified_time,
            deleted_at = NULL,
            updated_at = datetime('now')
    `),
    markNoteDeleted: db.prepare(`
        UPDATE note_registry
        SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE vault_id = ? AND drive_id = ?
    `),
    getNoteRenderCache: db.prepare(`
        SELECT *
        FROM note_render_cache
        WHERE vault_id = ? AND note_id = ?
        LIMIT 1
    `),
    upsertNoteRenderCache: db.prepare(`
        INSERT INTO note_render_cache (
            note_id, vault_id, html, markdown_content, search_text, tags_json, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(note_id, vault_id) DO UPDATE SET
            html = excluded.html,
            markdown_content = excluded.markdown_content,
            search_text = excluded.search_text,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            updated_at = datetime('now')
    `),
    deleteNoteRenderCache: db.prepare(`
        DELETE FROM note_render_cache
        WHERE vault_id = ? AND note_id = ?
    `),
    getPublishStateForNote: db.prepare(`
        SELECT *
        FROM note_publish_state
        WHERE vault_id = ? AND note_id = ?
        LIMIT 1
    `),
    upsertPublishState: db.prepare(`
        INSERT INTO note_publish_state (
            note_id, vault_id, visibility, is_draft, is_unlisted, published_at, unpublished_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(note_id, vault_id) DO UPDATE SET
            visibility = excluded.visibility,
            is_draft = excluded.is_draft,
            is_unlisted = excluded.is_unlisted,
            published_at = excluded.published_at,
            unpublished_at = excluded.unpublished_at,
            updated_by = excluded.updated_by,
            updated_at = datetime('now')
    `),

    // Comments
    createComment: db.prepare(`
        INSERT INTO comments (
            id, note_id, user_id, content, is_public, parent_id,
            selection_start, selection_end, selection_text, is_resolved
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getCommentsByNote: db.prepare(`
        SELECT c.*, u.display_name, u.email, u.role as user_role
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.note_id = ?
        ORDER BY c.created_at ASC
    `),
    getCommentById: db.prepare(`
        SELECT c.*, u.role as user_role
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.id = ?
        LIMIT 1
    `),
    deleteComment: db.prepare(`
        DELETE FROM comments WHERE id = ? AND user_id = ?
    `),
    updateComment: db.prepare(`
        UPDATE comments
        SET content = ?, is_public = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
    `),
    updateCommentResolution: db.prepare(`
        UPDATE comments
        SET is_resolved = ?, updated_at = datetime('now')
        WHERE id = ?
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
    getPushSubscriptionsByUser: db.prepare(`
        SELECT * FROM push_subscriptions WHERE user_id = ?
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

const queries = {
    getPushSubscriptionsForUserIds(userIds) {
        const normalized = Array.from(new Set((userIds || []).filter(Boolean)));
        if (normalized.length === 0) return [];

        const placeholders = normalized.map(() => '?').join(', ');
        return db.prepare(`
            SELECT *
            FROM push_subscriptions
            WHERE user_id IN (${placeholders})
        `).all(...normalized);
    },

    markMissingVaultNotesDeleted(vaultId, activeDriveIds) {
        const normalized = Array.from(new Set((activeDriveIds || []).filter(Boolean)));
        if (normalized.length === 0) {
            return db.prepare(`
                UPDATE note_registry
                SET deleted_at = datetime('now'), updated_at = datetime('now')
                WHERE vault_id = ? AND deleted_at IS NULL
            `).run(vaultId);
        }

        const placeholders = normalized.map(() => '?').join(', ');
        return db.prepare(`
            UPDATE note_registry
            SET deleted_at = datetime('now'), updated_at = datetime('now')
            WHERE vault_id = ?
              AND deleted_at IS NULL
              AND drive_id NOT IN (${placeholders})
        `).run(vaultId, ...normalized);
    }
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
    queries,
    cleanupInterval
};
