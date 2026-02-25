CREATE TABLE IF NOT EXISTS note_registry (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    drive_id TEXT NOT NULL,
    stable_note_id TEXT NOT NULL,
    legacy_id TEXT,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    modified_time TEXT,
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_id, drive_id),
    UNIQUE(vault_id, stable_note_id),
    FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_registry_vault ON note_registry(vault_id);
CREATE INDEX IF NOT EXISTS idx_note_registry_vault_deleted ON note_registry(vault_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_note_registry_stable ON note_registry(stable_note_id);

CREATE TABLE IF NOT EXISTS note_publish_state (
    note_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private', 'members')) DEFAULT 'public',
    is_draft INTEGER NOT NULL DEFAULT 0,
    is_unlisted INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    unpublished_at TEXT,
    updated_by TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_id, vault_id),
    FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_publish_state_vault ON note_publish_state(vault_id);
CREATE INDEX IF NOT EXISTS idx_note_publish_state_visibility ON note_publish_state(vault_id, visibility, is_draft, is_unlisted);

CREATE TABLE IF NOT EXISTS note_render_cache (
    note_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    html TEXT NOT NULL,
    markdown_content TEXT NOT NULL,
    search_text TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (note_id, vault_id),
    FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_render_cache_vault ON note_render_cache(vault_id);
