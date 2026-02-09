/**
 * Google Drive API Integration for Obsidian Notes
 */

const { google } = require('googleapis');
const matter = require('gray-matter');
const { marked } = require('marked');
const path = require('path');

// Cache for notes
let notesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
        } else {
            const noteId = noteMap.get(fileName.toLowerCase().replace(/\.md$/, ''));
            if (noteId) {
                return `<div class="embedded-note" data-embed="${noteId}"></div>`;
            }
            return `<span class="broken-embed">[Embedded: ${fileName}]</span>`;
        }
    });

    // Handle tags: #tag
    processed = processed.replace(/(?<!\S)#([a-zA-Z0-9_\-\/]+)/g, (match, tag) => {
        return `<span class="tag" data-tag="${tag}">#${tag}</span>`;
    });

    // Handle callouts
    const lines = processed.split('\n');
    const result = [];
    let inCallout = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);

        if (calloutMatch) {
            const [, type, title] = calloutMatch;
            result.push(`<div class="callout callout-${type.toLowerCase()}" data-callout-type="${type.toLowerCase()}"><div class="callout-title">${type}${title ? ': ' + title : ''}</div><div class="callout-content">`);
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

    const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000
    });

    for (const file of response.data.files || []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {

            // Recurse into subfolder
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
                folder: folderPath || null
            });
        }
    }

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
    notes.forEach(note => {
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
    notes.forEach(note => {
        const folderNode = folders.get(note.folder || '');
        if (folderNode) {
            folderNode.notes.push({ id: note.id, title: note.title });
        }
    });

    return tree;
}

// Fetch and process all notes
async function fetchNotes() {
    // Check cache
    if (notesCache && (Date.now() - cacheTimestamp < CACHE_TTL)) {
        console.log('📦 Returning cached notes');
        return notesCache;
    }

    console.log('🔄 Fetching notes from Google Drive...');

    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    // List all markdown files
    const files = await listFilesRecursively(drive, folderId);
    console.log(`📝 Found ${files.length} markdown files`);

    // Build note map for wikilinks
    const noteMap = new Map();
    files.forEach((file, index) => {
        const baseName = path.basename(file.name, '.md').toLowerCase();
        noteMap.set(baseName, `note-${index}`);
    });

    // Configure marked
    marked.setOptions({
        gfm: true,
        breaks: true
    });

    // Process each file
    const notes = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
            const content = await getFileContent(drive, file.id);
            const { data: frontmatter, content: markdownContent } = matter(content);

            const preprocessed = preprocessObsidian(markdownContent, noteMap);
            const html = marked.parse(preprocessed);

            const fileName = path.basename(file.name, '.md');

            notes.push({
                id: `note-${i}`,
                driveId: file.id,
                title: frontmatter.title || fileName,
                fileName,
                path: file.path,
                folder: file.folder,
                frontmatter,
                content: markdownContent,
                html,
                searchContent: markdownContent.toLowerCase().replace(/[#*`\[\]]/g, ' ').substring(0, 5000)
            });
        } catch (error) {
            console.error(`Error processing ${file.name}:`, error.message);
        }
    }

    // Build folder tree
    const folderTree = buildFolderTree(notes);

    // Build search index
    const searchIndex = notes.map(note => ({
        id: note.id,
        title: note.title,
        path: note.path,
        content: note.searchContent
    }));

    const result = {
        siteName: process.env.SITE_NAME || 'Obsidian Notes',
        notes: notes.map(n => ({
            id: n.id,
            title: n.title,
            path: n.path,
            folder: n.folder,
            html: n.html,
            content: n.content,
            frontmatter: n.frontmatter
        })),
        folderTree,
        searchIndex
    };

    // Update cache
    notesCache = result;
    cacheTimestamp = Date.now();

    console.log('✅ Notes loaded and cached');
    return result;
}

// Clear cache (for manual refresh)
function clearCache() {
    notesCache = null;
    cacheTimestamp = 0;
    console.log('🗑️ Cache cleared');
}

// Get attachment from Google Drive
async function getAttachment(fileName) {
    const drive = getDriveClient();

    // Use the separate attachments folder ID directly
    const attachmentsFolderId = process.env.ATTACHMENTS_FOLDER_ID;

    if (!attachmentsFolderId) {
        throw new Error('ATTACHMENTS_FOLDER_ID not set in .env');
    }

    // Find the file
    const fileResponse = await drive.files.list({
        q: `'${attachmentsFolderId}' in parents and name = '${fileName}' and trashed = false`,
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
    getAttachment
};
