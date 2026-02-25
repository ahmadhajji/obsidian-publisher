# Obsidian Publisher V3 Implementation Plan

This plan covers features:
- 1) Frontmatter publishing controls
- 2) True incremental sync
- 4) Tag and metadata pages
- 6) Push notifications
- 7) Comment workflow upgrades
- 8) Search upgrades
- 10) Multi-vault and role-based access

## Goals

- Keep current app behavior stable while introducing multi-vault and publishing controls.
- Ship in phases with feature flags and reversible DB migrations.
- Fit the existing HomeLab deployment model (docker-compose + systemd auto-deploy timer).

## Phase 0: Foundations (1-2 days)

### Deliverables
- Add `docs/DEPLOYMENT-HOMELAB.md` as deployment source of truth.
- Add feature flags:
  - `FEATURE_MULTI_VAULT`
  - `FEATURE_PUBLISH_CONTROLS`
  - `FEATURE_SEARCH_V2`
  - `FEATURE_COMMENTS_V2`
  - `FEATURE_PUSH_NOTIFICATIONS`
- Add migration framework (`lib/migrations/*.sql`) with version tracking table.

### Acceptance criteria
- App boots with all flags off and no behavior change.
- Migrations are idempotent and safe on restart.

## Phase 1: Data model and access model (features 1 + 10 base) (3-4 days)

### Schema changes
- `vaults`
  - `id`, `slug`, `name`, `drive_folder_id`, `attachments_folder_id`, `is_default`, timestamps
- `user_vault_roles`
  - `user_id`, `vault_id`, `role` (`owner|admin|editor|viewer`), timestamps
- `note_registry`
  - `id`, `vault_id`, `drive_id`, `stable_note_id`, `legacy_id`, `path`, `title`, `modified_time`, `deleted_at`, timestamps
- `note_publish_state`
  - `note_id`, `vault_id`, `visibility` (`public|members|private|unlisted`), `is_draft`, `published_at`, `unpublished_at`, `updated_by`

### Frontmatter contract
- Support in frontmatter:
  - `draft: true|false`
  - `private: true|false`
  - `unlisted: true|false`
  - `published_at: <ISO date>`
  - optional `vault: <slug>` override for advanced setups
- Resolution rules (priority):
  1. `draft: true` => never public
  2. `private: true` => only authorized vault users
  3. `published_at` in future => hidden until time
  4. `unlisted: true` => not in lists/search; direct URL only for authorized scope
  5. default => public

### API changes
- Add vault-aware endpoints:
  - `GET /api/vaults`
  - `GET /api/vaults/:vaultId/notes`
  - `GET /api/vaults/:vaultId/search`
- Keep current endpoints as default-vault aliases for backward compatibility.

### Acceptance criteria
- Existing single-vault env works unchanged as `default` vault.
- Visibility filtering enforced server-side for notes, search, comments.

## Phase 2: True incremental sync engine (feature 2, with multi-vault support) (4-5 days)

### Sync design
- Move from in-memory-only cache to persisted sync state in SQLite.
- For each vault, sync loop:
  1. list current Drive files (`id`, `name`, `modifiedTime`, parent path)
  2. compare with `note_registry`
  3. fetch/process only changed/new files
  4. soft-delete removed files (`deleted_at`)
  5. re-link only impacted notes when note-title map changes
- Keep 5-minute response cache as fast read layer, but invalidate by vault update token.

### Implementation notes
- Track link-map hash per vault to avoid full re-render unless title map changes.
- Persist rendered HTML/search blobs for unchanged notes between restarts.
- Add explicit `/api/admin/sync` (admin only) and background sync guard lock.

### Acceptance criteria
- Restart does not force full re-fetch of unchanged notes.
- Deleted/renamed files are reflected within one sync cycle.
- Sync can run vault-by-vault.

## Phase 3: Discovery features (features 4 + 8) (4-5 days)

### Tag and metadata pages (feature 4)
- Generate virtual pages per vault:
  - `/tags/:tag`
  - `/meta/:field/:value`
- Parse tags from both frontmatter and inline `#tag`.
- Add tag index endpoint and folder/tag filters in sidebar.

### Search v2 (feature 8)
- Search query parser:
  - plain terms + filters (`tag:`, `folder:`, `vault:`, `author:`, `is:draft`, `is:unlisted`)
- Ranking:
  - title exact > title prefix > tag/frontmatter > content matches
  - fuzzy fallback (Levenshtein distance threshold for typos)
- Keyboard quick switcher:
  - `Cmd/Ctrl+K` global palette, arrows + enter + recent notes

### Acceptance criteria
- Tag pages are linkable and SEO-safe for public notes only.
- Filtered queries return correct scoped results per role and vault.

## Phase 4: Collaboration upgrades (features 7 + 6) (4-6 days)

### Comments v2 (feature 7)
- Use existing schema selection fields (`selection_start`, `selection_end`, `selection_text`, `is_resolved`).
- Add APIs:
  - create inline comment with anchor
  - resolve/reopen thread
  - mention parsing (`@display_name`) and mention lookup
- UI:
  - text selection comment action
  - thread resolution state
  - jump-to-anchor behavior with fallback if content drifted

### Push notifications (feature 6)
- Add endpoints:
  - `POST /api/push/subscribe`
  - `POST /api/push/unsubscribe`
  - `POST /api/push/test` (admin)
- Add env vars:
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Trigger notifications on:
  - newly published notes
  - comment mentions/replies
- Preference controls per user/vault in `user_settings`.

### Acceptance criteria
- Subscribers receive web push for enabled events.
- Resolved threads are hidden by default and restorable.

## Phase 5: Hardening and rollout (2-3 days)

### Tests
- Unit:
  - visibility resolution logic
  - query parser + ranking
  - sync diff logic
- Integration:
  - vault role authorization across notes/search/comments
  - push subscribe/unsubscribe lifecycle
- Regression:
  - existing single-vault endpoints and export still work

### Operational rollout
- Deploy with features off.
- Enable in sequence:
  1. publish controls
  2. incremental sync
  3. search/tag pages
  4. comments v2
  5. push
  6. multi-vault UI
- Keep rollback strategy: disable flags first, then revert SHA if needed.

## Proposed endpoint compatibility strategy

- Keep old routes as wrappers over default vault for at least one release cycle.
- Return canonical IDs consistently (`drive-*`) and keep legacy alias resolution.
- Include `vaultId` in analytics and comments tables before removing assumptions.

## Migration and risk notes

- Risk: auto-deploy timer runs every minute and can overlap with long migration/sync startup.
  - Mitigation: startup migration lock + readiness check + fast-fail on lock timeout.
- Risk: role leaks across vaults.
  - Mitigation: centralized `authorizeVaultRole()` middleware used by all vault routes.
- Risk: index drift after rename/delete.
  - Mitigation: sync transaction updates `note_registry`, search index, and publish state atomically.

## Estimated timeline

- Total: ~3 weeks (17-25 engineering days depending on polish and QA depth).
- Earliest high-value release: end of week 1 (features 1 + 2 foundation).

## Immediate next implementation slice

1. Add migration framework + new tables (`vaults`, `user_vault_roles`, `note_registry`, `note_publish_state`).
2. Introduce default vault bootstrap from current env vars.
3. Implement server-side visibility resolver and apply it to `/api/notes` + `/api/search`.
4. Add tests for visibility rules and vault authorization middleware.
