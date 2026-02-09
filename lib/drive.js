/**
 * Google Drive API Integration for Obsidian Notes
 */

const { google } = require('googleapis');
const matter = require('gray-matter');
const { marked } = require('marked');
const path = require('path');
const { sanitizeRenderedHtml } = require('./sanitize');

// Cache for notes
let notesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Incremental processing cache
let processedNoteCache = new Map(); // driveId -> { modifiedTime, note }
let lastLinkMapSignature = null;
let idAliasMap = new Map(); // alias -> stable id

const DEFAULT_FETCH_CONCURRENCY = 6;

// Initialize Google Drive client
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

function rebuildIdAliases(notes) {
    const next = new Map();

    notes.forEach((note) => {
        next.set(note.id, note.id);
        if (note.legacyId) {
            next.set(note.legacyId, note.id);
        }
    });

    idAliasMap = next;
}

function resolveNoteId(noteId) {
    if (!noteId) return null;
    return idAliasMap.get(noteId) || noteId;
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

// Pre-process Obsidian-specific syntax
function preprocessObsidian(content, noteMap) {
    let processed = content;

    // Handle wikilinks: [[Note Name]] or [[Note Name|Display Text]]
    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, noteName, displayText) => {
        const display = displayText || noteName;
        const noteId = noteMap.get(noteName.toLowerCase().trim());
        if (noteId) {
            return `<a href="#" class="internal-link" data-note="${noteId}">${display}</a>`;
        }
        return `<span class="broken-link">${display}</span>`;
    });

    // Handle embeds: ![[Note Name]] or ![[image.png]]
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

    // Handle tags: #tag
    processed = processed.replace(/(?<!\S)#([a-zA-Z0-9_\-\/]+)/g, (match, tag) => {
        return `<span class="tag" data-tag="${tag}">#${tag}</span>`;
    });

    // Handle callouts
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

// List all markdown files in a folder recursively
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
                // Recurse into subfolder
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

// Get file content
async function getFileContent(drive, fileId) {
    const response = await drive.files.get({
        fileId,
        alt: 'media'
    });
    return response.data;
}

// Build folder tree structure
function buildFolderTree(notes) {
    const tree = { name: 'root', children: [], notes: [] };
    const folders = new Map();
    folders.set('', tree);

    // First pass: create all folders
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

    // Second pass: add notes to folders
    notes.forEach((note) => {
        const folderNode = folders.get(note.folder || '');
        if (folderNode) {
            folderNode.notes.push({ id: note.id, title: note.title });
        }
    });

    return tree;
}

function transformNoteForResponse(note) {
    return {
        id: note.id,
        legacyId: note.legacyId,
        title: note.title,
        path: note.path,
        folder: note.folder,
        html: note.html,
        content: note.content,
        frontmatter: note.frontmatter
    };
}

function buildSearchIndex(notes) {
    return notes.map((note) => ({
        id: note.id,
        legacyId: note.legacyId,
        title: note.title,
        path: note.path,
        content: note.searchContent
    }));
}

async function processNoteFile({ drive, file, noteMap, legacyId, forceReprocess }) {
    const stableId = createStableNoteId(file.id);

    if (!forceReprocess) {
        const cached = processedNoteCache.get(file.id);
        if (cached && cached.modifiedTime === file.modifiedTime) {
            return {
                ...cached.note,
                legacyId
            };
        }
    }

    const rawContent = await getFileContent(drive, file.id);
    const { data: frontmatter, content: markdownContent } = matter(rawContent);

    const preprocessed = preprocessObsidian(markdownContent, noteMap);
    const rawHtml = marked.parse(preprocessed);
    const sanitizedHtml = sanitizeRenderedHtml(rawHtml);

    const fileName = path.basename(file.name, '.md');
    const note = {
        id: stableId,
        legacyId,
        driveId: file.id,
        title: frontmatter.title || fileName,
        fileName,
        path: file.path,
        folder: file.folder,
        frontmatter,
        content: markdownContent,
        html: sanitizedHtml,
        searchContent: markdownContent
            .toLowerCase()
            .replace(/[#*`\[\]]/g, ' ')
            .substring(0, 5000)
    };

    processedNoteCache.set(file.id, {
        modifiedTime: file.modifiedTime,
        note: {
            ...note,
            legacyId: undefined
        }
    });

    return note;
}

function purgeDeletedFilesFromCache(currentFiles) {
    const keepIds = new Set(currentFiles.map((file) => file.id));
    for (const fileId of processedNoteCache.keys()) {
        if (!keepIds.has(fileId)) {
            processedNoteCache.delete(fileId);
        }
    }
}

// Fetch and process all notes
async function fetchNotes() {
    // Check cache
    if (notesCache && (Date.now() - cacheTimestamp < CACHE_TTL)) {
        console.log('Returning cached notes');
        return notesCache;
    }

    console.log('Fetching notes from Google Drive');

    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!folderId) {
        throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');
    }

    // List all markdown files
    const files = await listFilesRecursively(drive, folderId);
    console.log(`Found ${files.length} markdown files`);

    const linkMapSignature = createLinkMapSignature(files);
    const linkMapChanged = lastLinkMapSignature !== null && linkMapSignature !== lastLinkMapSignature;

    if (linkMapChanged) {
        processedNoteCache = new Map();
    }

    purgeDeletedFilesFromCache(files);

    // Build note map for wikilinks using stable IDs
    const noteMap = new Map();
    files.forEach((file) => {
        const baseName = path.basename(file.name, '.md').toLowerCase();
        noteMap.set(baseName, createStableNoteId(file.id));
    });

    // Configure marked
    marked.setOptions({
        gfm: true,
        breaks: true
    });

    const concurrency = Number(process.env.DRIVE_FETCH_CONCURRENCY) || DEFAULT_FETCH_CONCURRENCY;

    const processed = await mapWithConcurrency(
        files,
        concurrency,
        async (file, index) => {
            try {
                return await processNoteFile({
                    drive,
                    file,
                    noteMap,
                    legacyId: createLegacyNoteId(index),
                    forceReprocess: linkMapChanged
                });
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error.message);
                return null;
            }
        }
    );

    const notes = processed.filter(Boolean);

    // Build folder tree
    const folderTree = buildFolderTree(notes);

    const result = {
        siteName: process.env.SITE_NAME || 'Obsidian Notes',
        notes: notes.map(transformNoteForResponse),
        folderTree,
        searchIndex: buildSearchIndex(notes)
    };

    rebuildIdAliases(notes);

    // Update cache
    notesCache = result;
    cacheTimestamp = Date.now();
    lastLinkMapSignature = linkMapSignature;

    console.log('Notes loaded and cached');
    return result;
}

// Clear cache (for manual refresh)
function clearCache() {
    notesCache = null;
    cacheTimestamp = 0;
    console.log('Cache cleared');
}

// Get attachment from Google Drive
async function getAttachment(fileName) {
    const drive = getDriveClient();

    const attachmentsFolderId = process.env.ATTACHMENTS_FOLDER_ID;

    if (!attachmentsFolderId) {
        throw new Error('ATTACHMENTS_FOLDER_ID is not set');
    }

    const safeName = escapeDriveQueryValue(fileName);

    // Find the file
    const fileResponse = await drive.files.list({
        q: `'${attachmentsFolderId}' in parents and name = '${safeName}' and trashed = false`,
        fields: 'files(id, mimeType)'
    });

    if (!fileResponse.data.files?.length) {
        throw new Error('Attachment not found');
    }

    const file = fileResponse.data.files[0];

    // Get file content
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
    clearCache,
    getAttachment,
    resolveNoteId,
    createStableNoteId,
    createLegacyNoteId
};
