/**
 * Obsidian Publisher - Main Application
 */

// Global state
const state = {
    notes: [],
    folderTree: null,
    currentNote: null,
    selectMode: false,
    selectedNotes: new Set(),
    theme: localStorage.getItem('theme') || 'dark'
};

// DOM Elements
const elements = {
    loadingOverlay: document.getElementById('loadingOverlay'),
    siteTitle: document.getElementById('siteTitle'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    fileTree: document.getElementById('fileTree'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    noteContent: document.getElementById('noteContent'),
    noteTitle: document.getElementById('noteTitle'),
    noteMeta: document.getElementById('noteMeta'),
    noteBody: document.getElementById('noteBody'),
    themeToggle: document.getElementById('themeToggle'),
    selectModeBtn: document.getElementById('selectModeBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportModal: document.getElementById('exportModal'),
    closeModal: document.getElementById('closeModal')
};

// Initialize app
async function init() {
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

        // Set up event listeners
        setupEventListeners();

        // Check for note in URL hash
        if (window.location.hash) {
            const noteId = window.location.hash.slice(1);
            const note = state.notes.find(n => n.id === noteId);
            if (note) {
                navigateToNote(note);
            }
        }

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
            navigateToNote(note);
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

// Navigate to note
function navigateToNote(note) {
    state.currentNote = note;

    // Update URL
    window.history.pushState(null, '', `#${note.id}`);

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
    elements.noteMeta.textContent = note.path;
    elements.noteBody.innerHTML = note.html;

    // Handle internal links
    elements.noteBody.querySelectorAll('.internal-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.note;
            const targetNote = state.notes.find(n => n.id === targetId);
            if (targetNote) {
                navigateToNote(targetNote);
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

    // Scroll to top
    elements.noteContent.parentElement.scrollTop = 0;

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Theme toggle
    elements.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = state.theme;
        localStorage.setItem('theme', state.theme);
    });

    // Sidebar toggle (mobile)
    elements.sidebarToggle.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            elements.sidebar.classList.contains('open') &&
            !elements.sidebar.contains(e.target) &&
            !elements.sidebarToggle.contains(e.target)) {
            elements.sidebar.classList.remove('open');
        }
    });

    // Select mode toggle
    elements.selectModeBtn.addEventListener('click', () => {
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
    elements.exportBtn.addEventListener('click', () => {
        if (state.selectedNotes.size > 0) {
            showExportModal();
        } else if (state.currentNote) {
            // Export current note if no selection
            state.selectedNotes.add(state.currentNote.id);
            showExportModal();
        }
    });

    // Close modal
    elements.closeModal.addEventListener('click', hideExportModal);
    elements.exportModal.addEventListener('click', (e) => {
        if (e.target === elements.exportModal) {
            hideExportModal();
        }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        if (window.location.hash) {
            const noteId = window.location.hash.slice(1);
            const note = state.notes.find(n => n.id === noteId);
            if (note) {
                navigateToNote(note);
            }
        } else {
            // Show welcome screen
            state.currentNote = null;
            elements.noteContent.style.display = 'none';
            elements.welcomeScreen.style.display = 'flex';
            document.querySelectorAll('.tree-note').forEach(el => {
                el.classList.remove('active');
            });
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + K for search focus
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }

        // Escape to close modal or clear search
        if (e.key === 'Escape') {
            if (elements.exportModal.classList.contains('active')) {
                hideExportModal();
            }
        }
    });
}

// Update export button state
function updateExportButton() {
    const count = state.selectedNotes.size;
    elements.exportBtn.classList.toggle('active', count > 0);
}

// Show export modal
function showExportModal() {
    const count = state.selectedNotes.size;
    document.getElementById('selectedCount').textContent =
        `${count} note${count !== 1 ? 's' : ''} selected`;
    elements.exportModal.classList.add('active');
}

// Hide export modal
function hideExportModal() {
    elements.exportModal.classList.remove('active');
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
    navigateToNote,
    hideExportModal
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
