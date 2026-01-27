/**
 * Tabs System - Manage multiple open notes with per-tab navigation history
 */

class TabsManager {
    constructor() {
        this.tabs = [];
        this.activeTabId = null;
        this.closedTabs = []; // For Cmd+Shift+T reopen
        this.maxClosedTabs = 10;

        // Tab counter for unique IDs
        this.tabCounter = 0;

        // DOM elements
        this.tabsContainer = null;
        this.contentContainer = null;

        // Bind methods
        this.init = this.init.bind(this);
        this.openTab = this.openTab.bind(this);
        this.closeTab = this.closeTab.bind(this);
        this.switchToTab = this.switchToTab.bind(this);
    }

    init() {
        // Create tabs bar if not exists
        this.createTabsUI();
        this.setupKeyboardShortcuts();
        this.loadSavedTabs();
    }

    createTabsUI() {
        // Get or create tabs container
        this.tabsContainer = document.getElementById('tabsBar');
        if (!this.tabsContainer) {
            const mainContent = document.querySelector('.main-content');
            this.tabsContainer = document.createElement('div');
            this.tabsContainer.id = 'tabsBar';
            this.tabsContainer.className = 'tabs-bar';
            mainContent.insertBefore(this.tabsContainer, mainContent.firstChild);
        }

        // Create New Tab button if it doesn't exist
        if (!document.getElementById('newTabBtn')) {
            const newTabBtn = document.createElement('button');
            newTabBtn.id = 'newTabBtn';
            newTabBtn.className = 'new-tab-btn';
            newTabBtn.title = 'New Tab (Cmd+T)';
            newTabBtn.setAttribute('aria-label', 'Open new tab');
            newTabBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
            `;
            newTabBtn.addEventListener('click', () => this.openNewTab());
            this.tabsContainer.appendChild(newTabBtn);
        }

        this.contentContainer = document.getElementById('contentArea');
    }

    /**
     * Open a note in a new tab or existing tab
     * @param {Object} note - Note object with id, title, etc.
     * @param {boolean} newTab - Force new tab (middle-click, Cmd+click)
     */
    openTab(note, newTab = false) {
        // Check if note is already open
        const existingTab = this.tabs.find(t => t.noteId === note.id);

        if (existingTab && !newTab) {
            // Switch to existing tab
            this.switchToTab(existingTab.id);
            return existingTab;
        }

        // Create new tab
        const tab = {
            id: `tab-${++this.tabCounter}`,
            noteId: note.id,
            title: note.title,
            path: note.path,
            history: [note.id],  // Navigation history for this tab
            historyIndex: 0,
            scrollPosition: 0
        };

        this.tabs.push(tab);
        this.renderTab(tab);
        this.switchToTab(tab.id);
        this.saveTabs();

        return tab;
    }

    /**
     * Close a tab
     */
    closeTab(tabId, e) {
        if (e) {
            e.stopPropagation();
        }

        const tabIndex = this.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;

        const tab = this.tabs[tabIndex];

        // Save for potential reopen
        this.closedTabs.unshift(tab);
        if (this.closedTabs.length > this.maxClosedTabs) {
            this.closedTabs.pop();
        }

        // Remove tab
        this.tabs.splice(tabIndex, 1);

        // Remove DOM element
        const tabEl = document.getElementById(tabId);
        if (tabEl) tabEl.remove();

        // If we closed the active tab, switch to another
        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                // Switch to next tab, or previous if no next
                const newIndex = Math.min(tabIndex, this.tabs.length - 1);
                this.switchToTab(this.tabs[newIndex].id);
            } else {
                // No tabs left, show welcome screen
                this.activeTabId = null;
                this.showWelcomeScreen();
            }
        }

        this.saveTabs();
    }

    /**
     * Close other tabs (context menu action)
     */
    closeOtherTabs(tabId) {
        const tabsToClose = this.tabs.filter(t => t.id !== tabId);
        tabsToClose.forEach(t => this.closeTab(t.id));
    }

    /**
     * Close all tabs
     */
    closeAllTabs() {
        [...this.tabs].forEach(t => this.closeTab(t.id));
    }

    /**
     * Reopen last closed tab
     */
    reopenClosedTab() {
        if (this.closedTabs.length === 0) return null;

        const tab = this.closedTabs.shift();
        const note = window.obsidianPublisher.state.notes.find(n => n.id === tab.noteId);

        if (note) {
            return this.openTab(note, true);
        }
        return null;
    }

    /**
     * Open a new blank tab - shows note picker or welcome screen
     */
    openNewTab() {
        // Store that we want to open in new tab
        window._openInNewTab = true;
        
        // On mobile, open the sidebar to let user pick a note
        const sidebar = document.getElementById('sidebar');
        if (window.innerWidth <= 768 && sidebar) {
            sidebar.classList.add('open');
        }
        
        // Focus the search input to help user find a note
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.placeholder = '🔍 Search for a note to open in new tab...';
            searchInput.classList.add('new-tab-mode');
            
            // Reset after blur
            const resetSearch = () => {
                searchInput.placeholder = 'Search notes... (⌘K)';
                searchInput.classList.remove('new-tab-mode');
                // Reset after a delay to allow click-through
                setTimeout(() => {
                    window._openInNewTab = false;
                }, 500);
            };
            
            searchInput.addEventListener('blur', resetSearch, { once: true });
        } else {
            // If no search available, show a tip
            alert('Click on any note in the sidebar to open it in a new tab');
            window._openInNewTab = false;
        }
    }

    /**
     * Switch to a specific tab
     */
    switchToTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Save scroll position of current tab
        if (this.activeTabId) {
            const currentTab = this.tabs.find(t => t.id === this.activeTabId);
            if (currentTab) {
                const contentArea = document.getElementById('contentArea');
                currentTab.scrollPosition = contentArea?.scrollTop || 0;
            }
        }

        this.activeTabId = tabId;

        // Update tab bar UI
        document.querySelectorAll('.tab').forEach(el => {
            el.classList.toggle('active', el.id === tabId);
        });

        // Load note content
        const note = window.obsidianPublisher.state.notes.find(n => n.id === tab.noteId);
        if (note) {
            window.obsidianPublisher.displayNote(note);

            // Restore scroll position
            setTimeout(() => {
                const contentArea = document.getElementById('contentArea');
                if (contentArea) {
                    contentArea.scrollTop = tab.scrollPosition;
                }
            }, 0);
        }

        // Update URL
        window.history.replaceState(null, '', `/notes/${tab.noteId}`);

        this.updateNavButtons();
        this.saveTabs();
    }

    /**
     * Navigate back within current tab
     */
    goBack() {
        const tab = this.getActiveTab();
        if (!tab || tab.historyIndex <= 0) return;

        tab.historyIndex--;
        const noteId = tab.history[tab.historyIndex];
        const note = window.obsidianPublisher.state.notes.find(n => n.id === noteId);

        if (note) {
            tab.noteId = note.id;
            tab.title = note.title;
            this.updateTabUI(tab);
            window.obsidianPublisher.displayNote(note);
            this.updateNavButtons();
        }
    }

    /**
     * Navigate forward within current tab
     */
    goForward() {
        const tab = this.getActiveTab();
        if (!tab || tab.historyIndex >= tab.history.length - 1) return;

        tab.historyIndex++;
        const noteId = tab.history[tab.historyIndex];
        const note = window.obsidianPublisher.state.notes.find(n => n.id === noteId);

        if (note) {
            tab.noteId = note.id;
            tab.title = note.title;
            this.updateTabUI(tab);
            window.obsidianPublisher.displayNote(note);
            this.updateNavButtons();
        }
    }

    /**
     * Navigate to a note within current tab (adds to history)
     */
    navigateInTab(note) {
        const tab = this.getActiveTab();
        if (!tab) {
            this.openTab(note);
            return;
        }

        // If we're not at the end of history, truncate forward history
        if (tab.historyIndex < tab.history.length - 1) {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
        }

        // Add to history
        tab.history.push(note.id);
        tab.historyIndex = tab.history.length - 1;
        tab.noteId = note.id;
        tab.title = note.title;
        tab.path = note.path;
        tab.scrollPosition = 0;

        this.updateTabUI(tab);
        window.obsidianPublisher.displayNote(note);
        this.updateNavButtons();
        this.saveTabs();

        // Update URL
        window.history.pushState(null, '', `/notes/${note.id}`);
    }

    /**
     * Get active tab
     */
    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    /**
     * Render a tab element
     */
    renderTab(tab) {
        const tabEl = document.createElement('div');
        tabEl.id = tab.id;
        tabEl.className = 'tab';
        tabEl.innerHTML = `
            <span class="tab-title" title="${this.escapeHtml(tab.path)}">${this.escapeHtml(tab.title)}</span>
            <button class="tab-close" aria-label="Close tab">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        // Click to switch
        tabEl.addEventListener('click', () => this.switchToTab(tab.id));

        // Middle click to close
        tabEl.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                this.closeTab(tab.id, e);
            }
        });

        // Close button
        tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
            this.closeTab(tab.id, e);
        });

        // Context menu
        tabEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTabContextMenu(tab.id, e.clientX, e.clientY);
        });

        this.tabsContainer.appendChild(tabEl);
    }

    /**
     * Update tab UI after navigation
     */
    updateTabUI(tab) {
        const tabEl = document.getElementById(tab.id);
        if (tabEl) {
            const titleEl = tabEl.querySelector('.tab-title');
            titleEl.textContent = tab.title;
            titleEl.title = tab.path;
        }
    }

    /**
     * Update back/forward button states
     */
    updateNavButtons() {
        const tab = this.getActiveTab();
        const backBtn = document.getElementById('navBackBtn');
        const forwardBtn = document.getElementById('navForwardBtn');

        if (backBtn) {
            backBtn.disabled = !tab || tab.historyIndex <= 0;
        }
        if (forwardBtn) {
            forwardBtn.disabled = !tab || tab.historyIndex >= tab.history.length - 1;
        }
    }

    /**
     * Show context menu for tab
     */
    showTabContextMenu(tabId, x, y) {
        // Remove existing menu
        const existingMenu = document.querySelector('.tab-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'tab-context-menu';
        menu.innerHTML = `
            <button class="context-item" data-action="close">Close</button>
            <button class="context-item" data-action="close-others">Close Others</button>
            <button class="context-item" data-action="close-all">Close All</button>
            <hr>
            <button class="context-item" data-action="copy-link">Copy Link</button>
        `;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            switch (action) {
                case 'close':
                    this.closeTab(tabId);
                    break;
                case 'close-others':
                    this.closeOtherTabs(tabId);
                    break;
                case 'close-all':
                    this.closeAllTabs();
                    break;
                case 'copy-link':
                    const tab = this.tabs.find(t => t.id === tabId);
                    if (tab) {
                        navigator.clipboard.writeText(`${window.location.origin}/notes/${tab.noteId}`);
                    }
                    break;
            }
            menu.remove();
        });

        document.body.appendChild(menu);

        // Remove on click outside
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Cmd/Ctrl + T - new tab
            if ((e.metaKey || e.ctrlKey) && e.key === 't' && !e.shiftKey) {
                e.preventDefault();
                this.openNewTab();
            }

            // Cmd/Ctrl + W - close tab
            if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
                e.preventDefault();
                if (this.activeTabId) {
                    this.closeTab(this.activeTabId);
                }
            }

            // Cmd/Ctrl + Shift + T - reopen closed tab
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
                e.preventDefault();
                this.reopenClosedTab();
            }

            // Alt + Left - back
            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                this.goBack();
            }

            // Alt + Right - forward
            if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                this.goForward();
            }

            // Cmd/Ctrl + Tab - next tab
            if ((e.metaKey || e.ctrlKey) && e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                this.nextTab();
            }

            // Cmd/Ctrl + Shift + Tab - previous tab
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Tab') {
                e.preventDefault();
                this.previousTab();
            }
        });
    }

    /**
     * Switch to next tab
     */
    nextTab() {
        const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + 1) % this.tabs.length;
        this.switchToTab(this.tabs[nextIndex].id);
    }

    /**
     * Switch to previous tab
     */
    previousTab() {
        const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
        if (currentIndex === -1) return;
        const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
        this.switchToTab(this.tabs[prevIndex].id);
    }

    /**
     * Show welcome screen when no tabs open
     */
    showWelcomeScreen() {
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('noteContent').style.display = 'none';
    }

    /**
     * Save tabs to localStorage
     */
    saveTabs() {
        const data = {
            tabs: this.tabs.map(t => ({
                noteId: t.noteId,
                title: t.title,
                path: t.path,
                history: t.history,
                historyIndex: t.historyIndex,
                scrollPosition: t.scrollPosition
            })),
            activeNoteId: this.getActiveTab()?.noteId
        };
        localStorage.setItem('obsidian-publisher-tabs', JSON.stringify(data));
    }

    /**
     * Load tabs from localStorage
     */
    loadSavedTabs() {
        try {
            const saved = localStorage.getItem('obsidian-publisher-tabs');
            if (!saved) return;

            const data = JSON.parse(saved);
            const notes = window.obsidianPublisher.state.notes;

            // Restore tabs
            data.tabs.forEach(savedTab => {
                const note = notes.find(n => n.id === savedTab.noteId);
                if (note) {
                    const tab = {
                        id: `tab-${++this.tabCounter}`,
                        noteId: savedTab.noteId,
                        title: savedTab.title,
                        path: savedTab.path,
                        history: savedTab.history || [savedTab.noteId],
                        historyIndex: savedTab.historyIndex || 0,
                        scrollPosition: savedTab.scrollPosition || 0
                    };
                    this.tabs.push(tab);
                    this.renderTab(tab);
                }
            });

            // Restore active tab
            if (data.activeNoteId) {
                const activeTab = this.tabs.find(t => t.noteId === data.activeNoteId);
                if (activeTab) {
                    this.switchToTab(activeTab.id);
                }
            }
        } catch (e) {
            console.error('Error loading saved tabs:', e);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// Create singleton instance
window.tabsManager = new TabsManager();
