const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const matter = require('gray-matter');
const { marked } = require('marked');

// Load configuration
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Custom renderer for Obsidian-specific syntax
class ObsidianRenderer extends marked.Renderer {
    constructor(notes) {
        super();
        this.notes = notes;
        this.noteMap = new Map();
    }

    setNoteMap(noteMap) {
        this.noteMap = noteMap;
    }

    // Handle links - convert wikilinks to proper links
    link(href, title, text) {
        // Check if it's an internal note link
        if (href && !href.startsWith('http') && !href.startsWith('#')) {
            const noteName = href.replace(/\.md$/, '');
            const noteId = this.noteMap.get(noteName.toLowerCase());
            if (noteId) {
                return `<a href="#" class="internal-link" data-note="${noteId}">${text || noteName}</a>`;
            }
        }
        return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    }

    // Handle images
    image(href, title, text) {
        // Handle Obsidian image embeds
        const attachmentsFolder = config.attachmentsFolder || '89 Attachments';
        let imagePath = href;

        // If it's just a filename, assume it's in attachments
        if (!href.includes('/')) {
            imagePath = `attachments/${href}`;
        }

        return `<img src="${imagePath}" alt="${text || ''}" title="${title || ''}" loading="lazy" />`;
    }

    // Handle code blocks with syntax highlighting class
    code(code, language) {
        const lang = language || 'plaintext';
        return `<pre><code class="language-${lang}">${this.escapeHtml(code)}</code></pre>`;
    }

    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
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
        const attachmentsFolder = config.attachmentsFolder || '89 Attachments';

        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
            return `<img src="attachments/${fileName}" alt="${fileName}" class="embedded-image" loading="lazy" />`;
        } else {
            // It's an embedded note
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

    // Handle callouts: > [!TYPE] or > [!TYPE] Title
    processed = processed.replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, (match, type, title) => {
        return `<div class="callout callout-${type.toLowerCase()}" data-callout-type="${type.toLowerCase()}"><div class="callout-title">${type}${title ? ': ' + title : ''}</div><div class="callout-content">`;
    });

    // Close callouts (this is a simplified approach)
    // We need to handle multi-line callouts
    const lines = processed.split('\n');
    const result = [];
    let inCallout = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('class="callout callout-')) {
            inCallout = true;
            result.push(line);
        } else if (inCallout) {
            if (line.startsWith('> ')) {
                result.push(line.substring(2));
            } else if (line.trim() === '>') {
                result.push('');
            } else {
                // End of callout
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

// Build the note structure
async function buildNotes() {
    const notesFolder = path.resolve(config.notesFolder);
    const attachmentsFolder = config.attachmentsFolder || '89 Attachments';

    console.log(`📂 Scanning notes from: ${notesFolder}`);

    // Find all markdown files
    const files = await glob('**/*.md', {
        cwd: notesFolder,
        ignore: [`${attachmentsFolder}/**`, '**/node_modules/**', '**/.obsidian/**']
    });

    console.log(`📝 Found ${files.length} markdown files`);

    // Build note map for wikilinks
    const noteMap = new Map();
    files.forEach((file, index) => {
        const baseName = path.basename(file, '.md').toLowerCase();
        noteMap.set(baseName, `note-${index}`);
    });

    // Create custom renderer
    const renderer = new ObsidianRenderer();
    renderer.setNoteMap(noteMap);

    marked.setOptions({
        renderer,
        gfm: true,
        breaks: true
    });

    // Process each file
    const notes = [];
    const folders = new Map();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fullPath = path.join(notesFolder, file);
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Parse frontmatter
        const { data: frontmatter, content: markdownContent } = matter(content);

        // Preprocess and convert to HTML
        const preprocessed = preprocessObsidian(markdownContent, noteMap);
        const html = marked.parse(preprocessed);

        // Extract folder path
        const folderPath = path.dirname(file);
        const fileName = path.basename(file, '.md');

        // Track folder structure
        if (folderPath !== '.') {
            const parts = folderPath.split(path.sep);
            let currentPath = '';
            for (const part of parts) {
                const parentPath = currentPath;
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                if (!folders.has(currentPath)) {
                    folders.set(currentPath, {
                        name: part,
                        path: currentPath,
                        parent: parentPath || null
                    });
                }
            }
        }

        notes.push({
            id: `note-${i}`,
            title: frontmatter.title || fileName,
            fileName,
            path: file,
            folder: folderPath === '.' ? null : folderPath,
            frontmatter,
            content: markdownContent,
            html,
            searchContent: markdownContent.toLowerCase().replace(/[#*`\[\]]/g, ' ')
        });
    }

    // Build folder tree structure
    const folderTree = buildFolderTree(Array.from(folders.values()), notes);

    return { notes, folderTree, noteMap };
}

// Build hierarchical folder tree
function buildFolderTree(folders, notes) {
    const tree = { name: 'root', children: [], notes: [] };

    // Add root-level notes
    notes.filter(n => !n.folder).forEach(note => {
        tree.notes.push({ id: note.id, title: note.title });
    });

    // Build folder hierarchy
    const folderNodes = new Map();
    folderNodes.set('', tree);

    // Sort folders by path depth
    folders.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

    for (const folder of folders) {
        const node = {
            name: folder.name,
            path: folder.path,
            children: [],
            notes: []
        };

        // Add notes in this folder
        notes.filter(n => n.folder === folder.path).forEach(note => {
            node.notes.push({ id: note.id, title: note.title });
        });

        // Add to parent
        const parentNode = folderNodes.get(folder.parent || '');
        if (parentNode) {
            parentNode.children.push(node);
        }

        folderNodes.set(folder.path, node);
    }

    return tree;
}

// Build search index
function buildSearchIndex(notes) {
    return notes.map(note => ({
        id: note.id,
        title: note.title,
        path: note.path,
        content: note.searchContent.substring(0, 5000) // Limit content for search
    }));
}

// Copy static files
function copyStaticFiles() {
    const srcDir = path.join(__dirname, 'src');
    const distDir = path.join(__dirname, 'dist');

    // Create dist directories
    fs.mkdirSync(path.join(distDir, 'styles'), { recursive: true });
    fs.mkdirSync(path.join(distDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(distDir, 'attachments'), { recursive: true });

    // Copy HTML template
    const templatePath = path.join(srcDir, 'templates', 'index.html');
    if (fs.existsSync(templatePath)) {
        fs.copyFileSync(templatePath, path.join(distDir, 'index.html'));
    }

    // Copy CSS
    const cssPath = path.join(srcDir, 'styles', 'main.css');
    if (fs.existsSync(cssPath)) {
        fs.copyFileSync(cssPath, path.join(distDir, 'styles', 'main.css'));
    }

    // Copy JS files
    const jsFiles = ['app.js', 'search.js', 'export.js'];
    for (const jsFile of jsFiles) {
        const jsPath = path.join(srcDir, 'scripts', jsFile);
        if (fs.existsSync(jsPath)) {
            fs.copyFileSync(jsPath, path.join(distDir, 'scripts', jsFile));
        }
    }

    // Copy attachments folder if it exists
    const notesFolder = path.resolve(config.notesFolder);
    const attachmentsFolder = config.attachmentsFolder || '89 Attachments';
    const attachmentsSrc = path.join(notesFolder, attachmentsFolder);

    if (fs.existsSync(attachmentsSrc)) {
        copyFolderRecursive(attachmentsSrc, path.join(distDir, 'attachments'));
        console.log(`📎 Copied attachments from: ${attachmentsFolder}`);
    }
}

// Recursive folder copy
function copyFolderRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyFolderRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Main build function
async function build() {
    console.log('🚀 Building Obsidian Publisher...\n');

    try {
        // Build notes
        const { notes, folderTree } = await buildNotes();

        // Build search index
        const searchIndex = buildSearchIndex(notes);

        // Create dist directory
        const distDir = path.join(__dirname, 'dist');
        fs.mkdirSync(distDir, { recursive: true });

        // Write notes data
        const notesData = {
            siteName: config.siteName || 'Obsidian Notes',
            siteDescription: config.siteDescription || '',
            notes: notes.map(n => ({
                id: n.id,
                title: n.title,
                path: n.path,
                folder: n.folder,
                html: n.html,
                content: n.content // Original markdown for download
            })),
            folderTree
        };

        fs.writeFileSync(
            path.join(distDir, 'notes.json'),
            JSON.stringify(notesData, null, 2)
        );
        console.log('✅ Generated notes.json');

        // Write search index
        fs.writeFileSync(
            path.join(distDir, 'search-index.json'),
            JSON.stringify(searchIndex, null, 2)
        );
        console.log('✅ Generated search-index.json');

        // Copy static files
        copyStaticFiles();
        console.log('✅ Copied static files');

        console.log('\n🎉 Build complete! Output in ./dist');
        console.log('   Run "npm run serve" to preview locally');

    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

build();
