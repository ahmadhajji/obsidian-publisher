CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL,
    attachments_folder_id TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    link_map_signature TEXT,
    last_sync_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vaults_default ON vaults(is_default);
CREATE INDEX IF NOT EXISTS idx_vaults_slug ON vaults(slug);

CREATE TABLE IF NOT EXISTS user_vault_roles (
    user_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, vault_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (vault_id) REFERENCES vaults(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_vault_roles_vault ON user_vault_roles(vault_id);
CREATE INDEX IF NOT EXISTS idx_user_vault_roles_user ON user_vault_roles(user_id);
