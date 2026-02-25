/**
 * Google Drive API Integration for Obsidian Notes
 */

const { google } = require('googleapis');
const matter = require('gray-matter');
const { marked } = require('marked');
const path = require('path');
const { sanitizeRenderedHtml } = require('./sanitize');
const { statements, queries } = require('./db');
const { resolveVaultByIdOrSlug, getDefaultVault } = require('./vaults');
const { computePublishState, isPubliclyVisible } = require('./publish');

const CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_FETCH_CONCURRENCY = 6;

const vaultCache = new Map();
const vaultAliasMaps = new Map();
const syncLocks = new Set();

function getDriveClient() {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    auth.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    return google.drive({ version: 'v3', auth });
}

function createStableNoteId(driveId) {
    return `drive-${driveId}`;
}

function createLegacyNoteId(index) {
    return `note-${index}`;
}

function createLinkMapSignature(files) {
    return files
        .map((file) => `${file.id}:${path.basename(file.name, '.md').toLowerCase()}`)
        .sort()
        .join('|');
}

function escapeDriveQueryValue(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}

async function mapWithConcurrency(items, limit, asyncMapper) {
    const boundedLimit = Math.max(1, Number(limit) || 1);
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const idx = cursor;
            cursor += 1;
            results[idx] = await asyncMapper(items[idx], idx);
        }
    }

    const workers = Array.from(
        { length: Math.min(boundedLimit, items.length) },
        () => worker()
    );

    await Promise.all(workers);
    return results;
}

function preprocessObsidian(content, noteMap) {
    let processed = content;

    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, noteName, displayText) => {
        const display = displayText || noteName;
        const noteId = noteMap.get(noteName.toLowerCase().trim());
        if (noteId) {
            return `<a href="#" class="internal-link" data-note="${noteId}">${display}</a>`;
        }
        return `<span class="broken-link">${display}</span>`;
    });

    processed = processed.replace(/!\[\[([^\]]+)\]\]/g, (match, fileName) => {
        const ext = path.extname(fileName).toLowerCase();

        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
            return `<img src="/api/attachment/${encodeURIComponent(fileName)}" alt="${fileName}" class="embedded-image" loading="lazy" />`;
        }

        const noteId = noteMap.get(fileName.toLowerCase().replace(/\.md$/, ''));
        if (noteId) {
            return `<div class="embedded-note" data-embed="${noteId}"></div>`;
        }

        return `<span class="broken-embed">[Embedded: ${fileName}]</span>`;
    });

    processed = processed.replace(/(?<!\S)#([a-zA-Z0-9_\-\/]+)/g, (match, tag) => {
        return `<span class="tag" data-tag="${tag}">#${tag}</span>`;
    });

    const lines = processed.split('\n');
    const result = [];
    let inCallout = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);

        if (calloutMatch) {
            const [, type, title] = calloutMatch;
            result.push(`<div class="callout callout-${type.toLowerCase()}" data-callout-type="${type.toLowerCase()}"><div class="callout-title">${type}${title ? `: ${title}` : ''}</div><div class="callout-content">`);
            inCallout = true;
        } else if (inCallout) {
            if (line.startsWith('> ')) {
                result.push(line.substring(2));
            } else if (line.trim() === '>') {
                result.push('');
            } else {
                result.push('</div></div>');
                result.push(line);
                inCallout = false;
            }
        } else {
            result.push(line);
        }
    }

    if (inCallout) {
        result.push('</div></div>');
    }

    return result.join('\n');
}

async function listFilesRecursively(drive, folderId, folderPath = '') {
    const files = [];
    let pageToken;

    do {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
            pageSize: 1000,
            pageToken
        });

        const pageFiles = response.data.files || [];

        for (const file of pageFiles) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
                // eslint-disable-next-line no-await-in-loop
                const subFiles = await listFilesRecursively(
                    drive,
                    file.id,
                    folderPath ? `${folderPath}/${file.name}` : file.name
                );
                files.push(...subFiles);
            } else if (file.name.endsWith('.md')) {
                files.push({
                    id: file.id,
                    name: file.name,
                    path: folderPath ? `${folderPath}/${file.name}` : file.name,
                    folder: folderPath || null,
                    modifiedTime: file.modifiedTime || null
                });
            }
        }

        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return files;
}

async function getFileContent(drive, fileId) {
    const response = await drive.files.get({ fileId, alt: 'media' });
    return response.data;
}

function buildFolderTree(notes) {
    const tree = { name: 'root', children: [], notes: [] };
    const folders = new Map();
    folders.set('', tree);

    const allFolders = new Set();
    notes.forEach((note) => {
        if (note.folder) {
            const parts = note.folder.split('/');
            let current = '';
            for (const part of parts) {
                const parent = current;
                current = current ? `${current}/${part}` : part;
                if (!allFolders.has(current)) {
                    allFolders.add(current);
                    const node = { name: part, path: current, children: [], notes: [] };
                    folders.set(current, node);

                    const parentNode = folders.get(parent);
                    if (parentNode) {
                        parentNode.children.push(node);
                    }
                }
            }
        }
    });

    notes.forEach((note) => {
        const folderNode = folders.get(note.folder || '');
        if (folderNode) {
            folderNode.notes.push({ id: note.id, title: note.title });
        }
    });

    return tree;
}

function normalizeFrontmatter(frontmatter) {
    if (!frontmatter || typeof frontmatter !== 'object') {
        return {};
    }

    return frontmatter;
}

function extractTags(frontmatter, markdownContent) {
    const tags = new Set();

    const fmTags = frontmatter?.tags;
    if (Array.isArray(fmTags)) {
        fmTags.forEach((tag) => {
            const normalized = String(tag || '').trim().toLowerCase().replace(/^#/, '');
            if (normalized) tags.add(normalized);
        });
    } else if (typeof fmTags === 'string') {
        fmTags
            .split(/[;,]/g)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((tag) => {
                const normalized = tag.toLowerCase().replace(/^#/, '');
                if (normalized) tags.add(normalized);
            });
    }

    const inlineMatches = String(markdownContent || '').match(/(^|\s)#([a-zA-Z0-9_\-/]+)/g) || [];
    for (const match of inlineMatches) {
        const normalized = match.trim().replace(/^#/, '').toLowerCase();
        if (normalized) tags.add(normalized);
    }

    return Array.from(tags).sort();
}

function buildSearchText(frontmatter, markdownContent) {
    const frontmatterText = Object.entries(frontmatter || {})
        .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(' ') : String(value)}`)
        .join(' ');

    return `${frontmatterText}\n${markdownContent || ''}`
        .toLowerCase()
        .replace(/[#*`\[\]]/g, ' ')
        .substring(0, 10_000);
}

function toSearchEntry(note, vault) {
    return {
        id: note.id,
        legacyId: note.legacyId,
        title: note.title,
        path: note.path,
        folder: note.folder,
        vaultId: vault.id,
        vaultSlug: vault.slug,
        tags: note.tags || [],
        frontmatter: note.frontmatter || {},
        content: note.searchContent,
        isDraft: !!note.publishState?.isDraft,
        isUnlisted: !!note.publishState?.isUnlisted,
        visibility: note.publishState?.visibility || 'public',
        publishedAt: note.publishState?.publishedAt || null
    };
}

function transformNoteForResponse(note, vault) {
    return {
        id: note.id,
        legacyId: note.legacyId,
        vaultId: vault.id,
        vaultSlug: vault.slug,
        title: note.title,
        path: note.path,
        folder: note.folder,
        html: note.html,
        content: note.content,
        frontmatter: note.frontmatter,
        tags: note.tags || [],
        publishState: note.publishState
    };
}

function rebuildAliasMap(vaultId, notes) {
    const next = new Map();

    notes.forEach((note) => {
        next.set(note.id, note.id);
        if (note.legacyId) {
            next.set(note.legacyId, note.id);
        }
    });

    vaultAliasMaps.set(vaultId, next);
}

function resolveNoteId(noteId, vaultId = null) {
    if (!noteId) return null;

    const explicitVault = vaultId ? resolveVaultByIdOrSlug(vaultId) : null;
    if (explicitVault) {
        const aliasMap = vaultAliasMaps.get(explicitVault.id);
        if (aliasMap && aliasMap.has(noteId)) {
            return aliasMap.get(noteId);
        }
    }

    for (const aliasMap of vaultAliasMaps.values()) {
        if (aliasMap.has(noteId)) {
            return aliasMap.get(noteId);
        }
    }

    return noteId;
}

function resolveVaultOrThrow(vaultIdOrSlug) {
    const vault = resolveVaultByIdOrSlug(vaultIdOrSlug) || getDefaultVault();
    if (!vault) {
        throw new Error('No vault configured. Set GOOGLE_DRIVE_FOLDER_ID and restart.');
    }
    return vault;
}

function hydrateNoteFromCache(file, registryRow, renderCacheRow, noteMap) {
    if (!renderCacheRow) return null;

    const metadata = JSON.parse(renderCacheRow.metadata_json || '{}');
    const frontmatter = normalizeFrontmatter(metadata.frontmatter);
    const tags = Array.isArray(metadata.tags) ? metadata.tags : [];

    // Re-render from markdown if internal-link map changed.
    let html = renderCacheRow.html;
    if (metadata.requiresRelink) {
        const preprocessed = preprocessObsidian(renderCacheRow.markdown_content, noteMap);
        html = sanitizeRenderedHtml(marked.parse(preprocessed));
    }

    return {
        id: registryRow.stable_note_id,
        legacyId: registryRow.legacy_id,
        driveId: file.id,
        title: registryRow.title,
        fileName: path.basename(file.name, '.md'),
        path: file.path,
        folder: file.folder,
        frontmatter,
        content: renderCacheRow.markdown_content,
        html,
        searchContent: renderCacheRow.search_text,
        tags
    };
}

function shouldRerenderOnLinkMapChange(previousSignature, nextSignature) {
    if (!previousSignature) return false;
    return previousSignature !== nextSignature;
}

async function syncVault(vaultIdOrSlug, options = {}) {
    const vault = resolveVaultOrThrow(vaultIdOrSlug);
    const lockKey = vault.id;

    if (syncLocks.has(lockKey) && !options.force) {
        const cached = vaultCache.get(vault.id);
        if (cached?.data) return { ...cached.data, syncStats: { skipped: true } };
    }

    syncLocks.add(lockKey);
    const startedAt = Date.now();

    try {
        marked.setOptions({ gfm: true, breaks: true });

        const drive = getDriveClient();
        const files = await listFilesRecursively(drive, vault.drive_folder_id);
        const activeDriveIds = new Set(files.map((file) => file.id));

        const registryRows = statements.getNoteRegistryByVault.all(vault.id);
        const registryByDrive = new Map(registryRows.map((row) => [row.drive_id, row]));

        const linkMapSignature = createLinkMapSignature(files);
        const linkMapChanged = shouldRerenderOnLinkMapChange(vault.link_map_signature, linkMapSignature);

        const noteMap = new Map();
        files.forEach((file) => {
            const baseName = path.basename(file.name, '.md').toLowerCase();
            const existing = registryByDrive.get(file.id);
            noteMap.set(baseName, existing?.stable_note_id || createStableNoteId(file.id));
        });

        const nowIso = new Date().toISOString();
        const newlyPublished = [];

        const deletedRows = registryRows.filter((row) => !activeDriveIds.has(row.drive_id) && row.deleted_at === null);
        for (const row of deletedRows) {
            statements.markNoteDeleted.run(vault.id, row.drive_id);
        }
        queries.markMissingVaultNotesDeleted(vault.id, Array.from(activeDriveIds));

        const concurrency = Number(process.env.DRIVE_FETCH_CONCURRENCY) || DEFAULT_FETCH_CONCURRENCY;

        const processed = await mapWithConcurrency(files, concurrency, async (file, index) => {
            const registry = registryByDrive.get(file.id);
            const stableId = registry?.stable_note_id || createStableNoteId(file.id);
            const legacyId = registry?.legacy_id || createLegacyNoteId(index);
            const renderCache = statements.getNoteRenderCache.get(vault.id, stableId);

            const fileUnchanged = Boolean(
                registry
                && registry.modified_time === file.modifiedTime
                && !options.force
            );

            if (fileUnchanged && renderCache && !linkMapChanged) {
                const cached = hydrateNoteFromCache(file, {
                    ...registry,
                    stable_note_id: stableId,
                    legacy_id: legacyId,
                    title: registry.title
                }, renderCache, noteMap);

                if (cached) {
                    const publishStateRow = statements.getPublishStateForNote.get(vault.id, stableId);
                    cached.publishState = {
                        visibility: publishStateRow?.visibility || 'public',
                        isDraft: !!publishStateRow?.is_draft,
                        isUnlisted: !!publishStateRow?.is_unlisted,
                        publishedAt: publishStateRow?.published_at || null,
                        unpublishedAt: publishStateRow?.unpublished_at || null,
                        isScheduled: Boolean(
                            publishStateRow?.published_at
                                && new Date(publishStateRow.published_at).getTime() > Date.now()
                        )
                    };
                    return cached;
                }
            }

            let rawContent = null;

            if (fileUnchanged && renderCache?.markdown_content) {
                rawContent = renderCache.markdown_content;
            } else {
                rawContent = await getFileContent(drive, file.id);
            }

            const parsed = matter(rawContent);
            const frontmatter = normalizeFrontmatter(parsed.data);
            const markdownContent = parsed.content;
            const preprocessed = preprocessObsidian(markdownContent, noteMap);
            const rawHtml = marked.parse(preprocessed);
            const sanitizedHtml = sanitizeRenderedHtml(rawHtml);
            const tags = extractTags(frontmatter, markdownContent);

            const note = {
                id: stableId,
                legacyId,
                driveId: file.id,
                title: frontmatter.title || path.basename(file.name, '.md'),
                fileName: path.basename(file.name, '.md'),
                path: file.path,
                folder: file.folder,
                frontmatter,
                content: markdownContent,
                html: sanitizedHtml,
                searchContent: buildSearchText(frontmatter, markdownContent),
                tags
            };

            const publishState = computePublishState(frontmatter);
            note.publishState = publishState;

            const previousPublishState = statements.getPublishStateForNote.get(vault.id, stableId);
            const wasPublic = isPubliclyVisible(previousPublishState ? {
                visibility: previousPublishState.visibility,
                isDraft: !!previousPublishState.is_draft,
                isUnlisted: !!previousPublishState.is_unlisted,
                isScheduled: Boolean(
                    previousPublishState.published_at
                        && new Date(previousPublishState.published_at).getTime() > Date.now()
                )
            } : null);

            const nowPublic = isPubliclyVisible(publishState);
            if (!wasPublic && nowPublic) {
                newlyPublished.push({ id: note.id, title: note.title, path: note.path });
            }

            statements.upsertNoteRegistry.run(
                stableId,
                vault.id,
                file.id,
                stableId,
                legacyId,
                file.path,
                note.title,
                file.modifiedTime || null
            );

            statements.upsertNoteRenderCache.run(
                stableId,
                vault.id,
                note.html,
                note.content,
                note.searchContent,
                JSON.stringify(tags),
                JSON.stringify({
                    frontmatter,
                    tags,
                    path: file.path,
                    folder: file.folder,
                    title: note.title,
                    requiresRelink: false,
                    syncedAt: nowIso
                })
            );

            statements.upsertPublishState.run(
                stableId,
                vault.id,
                publishState.visibility,
                publishState.isDraft ? 1 : 0,
                publishState.isUnlisted ? 1 : 0,
                publishState.publishedAt,
                publishState.unpublishedAt,
                'system-sync'
            );

            return note;
        });

        const notes = processed.filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
        const folderTree = buildFolderTree(notes);

        const result = {
            siteName: vault.name,
            vault,
            notes: notes.map((note) => transformNoteForResponse(note, vault)),
            folderTree,
            searchIndex: notes.map((note) => toSearchEntry(note, vault)),
            syncedAt: new Date().toISOString(),
            newlyPublished,
            syncStats: {
                scanned: files.length,
                changed: processed.filter((n) => n).length,
                deleted: deletedRows.length,
                durationMs: Date.now() - startedAt,
                linkMapChanged
            }
        };

        statements.updateVaultSyncState.run(linkMapSignature, vault.id);

        rebuildAliasMap(vault.id, notes);

        const existing = vaultCache.get(vault.id) || {};
        vaultCache.set(vault.id, {
            data: result,
            lastGoodData: result,
            timestamp: Date.now(),
            lastError: null,
            lastSyncedAt: Date.now(),
            previous: existing.data || null
        });

        return result;
    } catch (error) {
        const cached = vaultCache.get(vault.id);
        if (cached?.lastGoodData) {
            vaultCache.set(vault.id, {
                ...cached,
                lastError: error.message,
                timestamp: Date.now()
            });
            return {
                ...cached.lastGoodData,
                stale: true,
                syncError: error.message,
                syncStats: { failed: true }
            };
        }

        throw error;
    } finally {
        syncLocks.delete(lockKey);
    }
}

async function fetchVaultNotes(vaultIdOrSlug, options = {}) {
    const vault = resolveVaultOrThrow(vaultIdOrSlug);
    const now = Date.now();

    const cached = vaultCache.get(vault.id);
    const stale = !cached || (now - cached.timestamp >= CACHE_TTL);

    if (!stale && !options.force) {
        return cached.data;
    }

    return syncVault(vault.id, options);
}

async function fetchNotes(options = {}) {
    const defaultVault = getDefaultVault();
    if (!defaultVault) {
        throw new Error('No default vault configured');
    }

    return fetchVaultNotes(defaultVault.id, options);
}

async function syncAllVaults(options = {}) {
    const vaults = statements.listAllVaults.all();
    const results = [];

    for (const vault of vaults) {
        // eslint-disable-next-line no-await-in-loop
        const result = await syncVault(vault.id, options);
        results.push({ vault, result });
    }

    return results;
}

function clearCache(vaultIdOrSlug = null) {
    if (!vaultIdOrSlug) {
        vaultCache.clear();
        return;
    }

    const vault = resolveVaultByIdOrSlug(vaultIdOrSlug);
    if (!vault) return;
    vaultCache.delete(vault.id);
}

async function getAttachment(fileName, vaultIdOrSlug = null) {
    const vault = resolveVaultOrThrow(vaultIdOrSlug);
    const drive = getDriveClient();

    const attachmentsFolderId = vault.attachments_folder_id || process.env.ATTACHMENTS_FOLDER_ID;
    if (!attachmentsFolderId) {
        throw new Error('ATTACHMENTS_FOLDER_ID is not set');
    }

    const safeName = escapeDriveQueryValue(fileName);

    const fileResponse = await drive.files.list({
        q: `'${attachmentsFolderId}' in parents and name = '${safeName}' and trashed = false`,
        fields: 'files(id, mimeType)'
    });

    if (!fileResponse.data.files?.length) {
        throw new Error('Attachment not found');
    }

    const file = fileResponse.data.files[0];

    const content = await drive.files.get({
        fileId: file.id,
        alt: 'media'
    }, { responseType: 'arraybuffer' });

    return {
        data: Buffer.from(content.data),
        mimeType: file.mimeType
    };
}

module.exports = {
    fetchNotes,
    fetchVaultNotes,
    syncVault,
    syncAllVaults,
    clearCache,
    getAttachment,
    resolveNoteId,
    createStableNoteId,
    createLegacyNoteId
};
