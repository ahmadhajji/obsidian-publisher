/**
 * Obsidian Publisher V2 - Main Application
 */

// Global state
const state = {
    notes: [],
    folderTree: null,
    currentNote: null,
    selectMode: false,
    selectedNotes: new Set(),
    theme: localStorage.getItem('theme') || 'dark',
    user: null,
    currentViewId: null // For analytics time tracking
};

// DOM Elements
const elements = {
    loadingOverlay: null,
    siteTitle: null,
    sidebar: null,
    sidebarToggle: null,
    fileTree: null,
    welcomeScreen: null,
    noteContent: null,
    noteTitle: null,
    noteMeta: null,
    noteBody: null,
    themeToggle: null,
    selectModeBtn: null,
    exportBtn: null,
    exportModal: null,
    closeModal: null
};

// Initialize app
async function init() {
    // Cache DOM elements
    Object.keys(elements).forEach(key => {
        elements[key] = document.getElementById(key) || document.getElementById(key.replace(/([A-Z])/g, m => m.toLowerCase()));
    });

    elements.loadingOverlay = document.getElementById('loadingOverlay');
    elements.siteTitle = document.getElementById('siteTitle');
    elements.sidebar = document.getElementById('sidebar');
    elements.sidebarToggle = document.getElementById('sidebarToggle');
    elements.fileTree = document.getElementById('fileTree');
    elements.welcomeScreen = document.getElementById('welcomeScreen');
    elements.noteContent = document.getElementById('noteContent');
    elements.noteTitle = document.getElementById('noteTitle');
    elements.noteMeta = document.getElementById('noteMeta');
    elements.noteBody = document.getElementById('noteBody');
    elements.themeToggle = document.getElementById('themeToggle');
    elements.selectModeBtn = document.getElementById('selectModeBtn');
    elements.exportBtn = document.getElementById('exportBtn');
    elements.exportModal = document.getElementById('exportModal');
    elements.closeModal = document.getElementById('closeModal');

    try {
        // Apply saved theme
        document.documentElement.dataset.theme = state.theme;

        // Load notes data from API
        const response = await fetch('/api/notes');
        if (!response.ok) throw new Error('Failed to load notes');

        const data = await response.json();
        state.notes = data.notes;
        state.folderTree = data.folderTree;

        // Update site title
        if (data.siteName) {
            elements.siteTitle.textContent = data.siteName;
            document.title = data.siteName;
        }

        // Render file tree
        renderFileTree();

        // Handle initial URL route
        handleInitialRoute();

        // Hide loading overlay
        elements.loadingOverlay.classList.add('hidden');

    } catch (error) {
        console.error('Failed to initialize app:', error);
        elements.loadingOverlay.innerHTML = `
      <div style="text-align: center; color: var(--error);">
        <p>Failed to load notes</p>
        <p style="font-size: 0.8rem; margin-top: 8px;">${error.message || 'Check server connection'}</p>
        <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; cursor: pointer;">Retry</button>
      </div>
    `;
    }

    // Always initialize these regardless of API success
    setupEventListeners();
    initializeV2Components();
}


// Initialize V2 components
function initializeV2Components() {
    // Initialize tabs manager
    if (window.tabsManager) {
        window.tabsManager.init();
    }

    // Initialize typography settings
    if (window.typographySettings) {
        window.typographySettings.init();
    }

    // Initialize auth UI
    if (window.authUI) {
        window.authUI.init();
    }

    // Initialize comments UI
    if (window.commentsUI) {
        window.commentsUI.init();
    }

    // Initialize analytics dashboard
    if (window.analyticsDashboard) {
        window.analyticsDashboard.init();
    }

    // Initialize history panel
    if (window.historyPanel) {
        window.historyPanel.init();
    }

    // Add share button to toolbar
    addShareButton();

    // Add navigation buttons
    addNavigationButtons();

    // Setup reading position tracking
    setupReadingPositionTracking();
}

// Handle initial URL routing
function handleInitialRoute() {
    const path = window.location.pathname;

    // Check for note routes (supports both /notes/:id and nested preview routes)
    const noteMatch = path.match(/^(.*)\/notes\/(.+)$/);
    if (noteMatch) {
        const routePrefix = noteMatch[1] || '';
        const noteId = noteMatch[2];
        const note = state.notes.find(n => n.id === noteId || n.legacyId === noteId);
        if (note) {
            if (note.id !== noteId) {
                const base = routePrefix || '';
                window.history.replaceState({}, '', `${base}/notes/${note.id}`);
            }
            if (window.tabsManager) {
                window.tabsManager.openTab(note);
            } else {
                displayNote(note);
            }
            return;
        }
    }

    // Check for hash-based routing (legacy)
    if (window.location.hash) {
        const noteId = window.location.hash.slice(1);
        const note = state.notes.find(n => n.id === noteId || n.legacyId === noteId);
        if (note) {
            if (window.tabsManager) {
                window.tabsManager.openTab(note);
            } else {
                displayNote(note);
            }
        }
    }
}

// Add share button to toolbar
function addShareButton() {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;

    const shareBtn = document.createElement('button');
    shareBtn.id = 'shareBtn';
    shareBtn.className = 'toolbar-btn';
    shareBtn.title = 'Share Link';
    shareBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>
        </svg>
    `;

    shareBtn.addEventListener('click', copyShareLink);
    toolbar.insertBefore(shareBtn, toolbar.querySelector('#themeToggle'));
}

// Add back/forward navigation buttons
function addNavigationButtons() {
    const header = document.querySelector('.note-header');
    if (!header) return;

    const navContainer = document.createElement('div');
    navContainer.className = 'nav-buttons';
    navContainer.innerHTML = `
        <button id="navBackBtn" class="nav-btn" title="Go Back (Alt+←)" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
        </button>
        <button id="navForwardBtn" class="nav-btn" title="Go Forward (Alt+→)" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        </button>
    `;

    header.insertBefore(navContainer, header.firstChild);

    document.getElementById('navBackBtn').addEventListener('click', () => {
        window.tabsManager?.goBack();
    });

    document.getElementById('navForwardBtn').addEventListener('click', () => {
        window.tabsManager?.goForward();
    });
}

// Copy share link to clipboard
async function copyShareLink() {
    if (!state.currentNote) {
        alert('No note selected');
        return;
    }

    try {
        const response = await fetch(`/api/share/${state.currentNote.id}`);
        const data = await response.json();

        await navigator.clipboard.writeText(data.shareUrl);

        // Show feedback
        const shareBtn = document.getElementById('shareBtn');
        shareBtn.classList.add('copied');
        shareBtn.title = 'Copied!';

        setTimeout(() => {
            shareBtn.classList.remove('copied');
            shareBtn.title = 'Share Link';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy link:', error);
        // Fallback: copy current URL
        await navigator.clipboard.writeText(window.location.href);
    }
}

// Setup reading position tracking
function setupReadingPositionTracking() {
    let lastSaveTime = 0;
    const saveInterval = 5000; // Save every 5 seconds

    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    contentArea.addEventListener('scroll', () => {
        if (!state.currentNote || !state.user) return;

        const now = Date.now();
        if (now - lastSaveTime < saveInterval) return;
        lastSaveTime = now;

        const scrollTop = contentArea.scrollTop;
        const scrollHeight = contentArea.scrollHeight - contentArea.clientHeight;
        const scrollPosition = scrollHeight > 0 ? scrollTop / scrollHeight : 0;

        // Save position to server
        fetch('/api/reading/position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                noteId: state.currentNote.id,
                scrollPosition
            })
        }).catch(console.error);
    });
}

// Render file tree
function renderFileTree() {
    elements.fileTree.innerHTML = '';

    if (!state.folderTree) return;

    // Render root notes
    state.folderTree.notes.forEach(note => {
        elements.fileTree.appendChild(createNoteElement(note));
    });

    // Render folders
    state.folderTree.children.forEach(folder => {
        elements.fileTree.appendChild(createFolderElement(folder));
    });
}

// Create folder element
function createFolderElement(folder) {
    const folderDiv = document.createElement('div');
    folderDiv.className = 'tree-folder';

    const header = document.createElement('div');
    header.className = 'tree-folder-header';
    header.innerHTML = `
    <svg class="tree-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18l6-6-6-6"/>
    </svg>
    <span class="tree-folder-name">${escapeHtml(folder.name)}</span>
  `;

    header.addEventListener('click', () => {
        folderDiv.classList.toggle('open');
    });

    const content = document.createElement('div');
    content.className = 'tree-folder-content';

    // Add notes in this folder
    folder.notes.forEach(note => {
        content.appendChild(createNoteElement(note));
    });

    // Add subfolders
    folder.children.forEach(subfolder => {
        content.appendChild(createFolderElement(subfolder));
    });

    folderDiv.appendChild(header);
    folderDiv.appendChild(content);

    return folderDiv;
}

// Create note element
function createNoteElement(noteMeta) {
    const noteDiv = document.createElement('div');
    noteDiv.className = 'tree-note';
    noteDiv.dataset.noteId = noteMeta.id;

    noteDiv.innerHTML = `
    <input type="checkbox" class="tree-note-checkbox" data-note-id="${noteMeta.id}">
    <svg class="tree-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="tree-note-name">${escapeHtml(noteMeta.title)}</span>
  `;

    // Note click handler
    noteDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('tree-note-checkbox')) {
            return; // Let checkbox handle itself
        }

        const note = state.notes.find(n => n.id === noteMeta.id);
        if (note) {
            // Check for middle-click, Cmd/Ctrl+click, or "new tab mode" for new tab
            if (e.button === 1 || e.metaKey || e.ctrlKey || window._openInNewTab) {
                window.tabsManager?.openTab(note, true);
                window._openInNewTab = false;
                // Close sidebar on mobile after selecting
                if (window.innerWidth <= 768) {
                    document.getElementById('sidebar')?.classList.remove('open');
                }
            } else if (window.tabsManager?.getActiveTab()) {
                window.tabsManager.navigateInTab(note);
            } else {
                window.tabsManager?.openTab(note);
            }
        }
    });

    // Middle click handler
    noteDiv.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            const note = state.notes.find(n => n.id === noteMeta.id);
            if (note) {
                window.tabsManager?.openTab(note, true);
            }
        }
    });

    // Checkbox change handler
    const checkbox = noteDiv.querySelector('.tree-note-checkbox');
    checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            state.selectedNotes.add(noteMeta.id);
        } else {
            state.selectedNotes.delete(noteMeta.id);
        }
        updateExportButton();
    });

    return noteDiv;
}

// Display a note (called by tabs manager)
function displayNote(note) {
    state.currentNote = note;

    // Update active state in file tree
    document.querySelectorAll('.tree-note').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.noteId === note.id) {
            el.classList.add('active');
        }
    });

    // Show note content
    elements.welcomeScreen.style.display = 'none';
    elements.noteContent.style.display = 'block';

    // Update note display
    elements.noteTitle.textContent = note.title;

    // Render breadcrumb
    elements.noteMeta.innerHTML = renderBreadcrumb(note);

    // Render properties if frontmatter exists
    const propertiesHtml = renderProperties(note.frontmatter);
    elements.noteBody.innerHTML = propertiesHtml + note.html;

    // Handle internal links
    elements.noteBody.querySelectorAll('.internal-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.note;
            const targetNote = state.notes.find(n => n.id === targetId);
            if (targetNote) {
                if (window.tabsManager?.getActiveTab()) {
                    window.tabsManager.navigateInTab(targetNote);
                } else {
                    window.tabsManager?.openTab(targetNote);
                }
            }
        });
    });

    // Handle embedded notes
    elements.noteBody.querySelectorAll('.embedded-note').forEach(embed => {
        const embedId = embed.dataset.embed;
        const embedNote = state.notes.find(n => n.id === embedId);
        if (embedNote) {
            embed.innerHTML = `
        <div class="embedded-note-title">${escapeHtml(embedNote.title)}</div>
        <div class="embedded-note-content">${embedNote.html}</div>
      `;
        }
    });

    // Load comments
    if (window.commentsUI) {
        window.commentsUI.loadComments(note.id);
    }

    // Record analytics view
    recordNoteView(note.id);

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
    }
}

// Render breadcrumb navigation
function renderBreadcrumb(note) {
    const parts = note.path.split('/');
    const breadcrumbs = [];

    // Add home
    breadcrumbs.push(`<a href="/" class="breadcrumb-item breadcrumb-home" title="Home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
    </a>`);

    // Add folder path
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
        currentPath += (i > 0 ? '/' : '') + parts[i];
        breadcrumbs.push(`<span class="breadcrumb-separator">/</span>`);
        breadcrumbs.push(`<span class="breadcrumb-item breadcrumb-folder">${escapeHtml(parts[i])}</span>`);
    }

    // Add current note
    breadcrumbs.push(`<span class="breadcrumb-separator">/</span>`);
    breadcrumbs.push(`<span class="breadcrumb-item breadcrumb-current">${escapeHtml(note.title)}</span>`);

    return `<div class="breadcrumb">${breadcrumbs.join('')}</div>`;
}

// Render frontmatter properties
function renderProperties(frontmatter) {
    if (!frontmatter || Object.keys(frontmatter).length === 0) {
        return '';
    }

    // Icon map for common property names
    const iconMap = {
        title: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>`,
        source: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
        topic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
        tags: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
        created: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        date: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        'video link': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
        link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        url: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`
    };

    const properties = [];

    for (const [key, value] of Object.entries(frontmatter)) {
        if (value === null || value === undefined || value === '') continue;

        const icon = iconMap[key.toLowerCase()] || iconMap.default;
        let valueHtml;

        if (key.toLowerCase() === 'tags') {
            // Handle tags as array or string
            const tagsArray = Array.isArray(value) ? value : [value];
            valueHtml = `<div class="note-property-tags">${tagsArray.map(tag => 
                `<span class="note-property-tag">#${escapeHtml(String(tag))}</span>`
            ).join('')}</div>`;
        } else if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
            // Handle URLs
            valueHtml = `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
        } else if (Array.isArray(value)) {
            // Handle arrays (other than tags)
            valueHtml = escapeHtml(value.join(', '));
        } else if (typeof value === 'object' && value instanceof Date) {
            // Handle Date objects
            valueHtml = escapeHtml(value.toLocaleDateString());
        } else {
            // Handle other values
            valueHtml = escapeHtml(String(value));
        }

        properties.push(`
            <div class="note-property">
                <span class="note-property-icon">${icon}</span>
                <span class="note-property-name">${escapeHtml(key)}</span>
                <span class="note-property-value">${valueHtml}</span>
            </div>
        `);
    }

    if (properties.length === 0) return '';

    return `
        <div class="note-properties">
            <div class="note-properties-title">Properties</div>
            <div class="note-properties-list">
                ${properties.join('')}
            </div>
        </div>
    `;
}

// Record note view for analytics
async function recordNoteView(noteId) {
    try {
        const response = await fetch(`/api/notes/${noteId}`, {
            credentials: 'include'
        });
        const data = await response.json();
        state.currentViewId = data.viewId;

        // Start time tracking
        startTimeTracking();
    } catch (error) {
        console.error('Failed to record view:', error);
    }
}

// Track time spent on note
let timeTrackingInterval = null;
let timeSpent = 0;

function startTimeTracking() {
    stopTimeTracking();
    timeSpent = 0;

    timeTrackingInterval = setInterval(() => {
        timeSpent += 5;

        // Send update every 30 seconds
        if (timeSpent % 30 === 0 && state.currentViewId) {
            fetch('/api/analytics/time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    viewId: state.currentViewId,
                    seconds: timeSpent
                })
            }).catch(console.error);
        }
    }, 5000);
}

function stopTimeTracking() {
    if (timeTrackingInterval) {
        clearInterval(timeTrackingInterval);
        timeTrackingInterval = null;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Theme toggle
    elements.themeToggle?.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = state.theme;
        localStorage.setItem('theme', state.theme);
    });

    // Sidebar toggle (mobile)
    elements.sidebarToggle?.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            elements.sidebar?.classList.contains('open') &&
            !elements.sidebar?.contains(e.target) &&
            !elements.sidebarToggle?.contains(e.target)) {
            elements.sidebar.classList.remove('open');
        }
    });

    // Select mode toggle
    elements.selectModeBtn?.addEventListener('click', () => {
        state.selectMode = !state.selectMode;
        elements.selectModeBtn.classList.toggle('active', state.selectMode);
        elements.fileTree.classList.toggle('select-mode', state.selectMode);

        if (!state.selectMode) {
            // Clear selections when exiting select mode
            state.selectedNotes.clear();
            document.querySelectorAll('.tree-note-checkbox').forEach(cb => {
                cb.checked = false;
            });
        }

        updateExportButton();
    });

    // Export button
    elements.exportBtn?.addEventListener('click', () => {
        if (state.selectedNotes.size > 0) {
            showExportModal();
        } else if (state.currentNote) {
            // Export current note if no selection
            state.selectedNotes.add(state.currentNote.id);
            showExportModal();
        }
    });

    // Close modal
    elements.closeModal?.addEventListener('click', hideExportModal);
    elements.exportModal?.addEventListener('click', (e) => {
        if (e.target === elements.exportModal) {
            hideExportModal();
        }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        handleInitialRoute();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + K for search focus
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
        }

        // Escape to close modal or clear search
        if (e.key === 'Escape') {
            if (elements.exportModal?.classList.contains('active')) {
                hideExportModal();
            }
        }
    });

    // Before unload - send final time update
    window.addEventListener('beforeunload', () => {
        if (state.currentViewId && timeSpent > 0) {
            const payload = new Blob([JSON.stringify({
                viewId: state.currentViewId,
                seconds: timeSpent
            })], { type: 'application/json' });
            navigator.sendBeacon('/api/analytics/time', payload);
        }
    });
}

// Update export button state
function updateExportButton() {
    const count = state.selectedNotes.size;
    elements.exportBtn?.classList.toggle('active', count > 0);
}

// Show export modal
function showExportModal() {
    const count = state.selectedNotes.size;
    const countEl = document.getElementById('selectedCount');
    if (countEl) {
        countEl.textContent = `${count} note${count !== 1 ? 's' : ''} selected`;
    }
    elements.exportModal?.classList.add('active');
}

// Hide export modal
function hideExportModal() {
    elements.exportModal?.classList.remove('active');
}

// Utility: escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose state and functions for other modules
window.obsidianPublisher = {
    state,
    displayNote,
    hideExportModal,
    escapeHtml
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
