/**
 * Settings Module for Clinical Vault
 * Handles settings modal, preferences, and first-visit welcome popup
 */

(function () {
    // Settings state
    const settings = {
        theme: localStorage.getItem('theme') || 'dark',
        fontSize: parseInt(localStorage.getItem('fontSize')) || 16,
        sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
        hasVisited: localStorage.getItem('hasVisited') === 'true'
    };

    // DOM Elements
    const elements = {
        settingsBtn: document.getElementById('settingsBtn'),
        settingsModal: document.getElementById('settingsModal'),
        closeSettingsModal: document.getElementById('closeSettingsModal'),
        fontSizeSlider: document.getElementById('fontSizeSlider'),
        fontSizeValue: document.getElementById('fontSizeValue'),
        sidebarCollapsedToggle: document.getElementById('sidebarCollapsedToggle'),
        welcomePopup: document.getElementById('welcomePopup'),
        dismissWelcome: document.getElementById('dismissWelcome'),
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebarToggle')
    };

    // Initialize settings
    function init() {
        // Apply saved settings
        applySettings();

        // Show welcome popup for first-time visitors
        if (!settings.hasVisited) {
            setTimeout(() => {
                elements.welcomePopup.classList.add('active');
            }, 500);
        }

        // Setup event listeners
        setupEventListeners();
    }

    // Apply all settings
    function applySettings() {
        // Apply theme
        document.documentElement.dataset.theme = settings.theme;
        updateThemeButtons();

        // Apply font size
        document.documentElement.style.setProperty('--note-font-size', `${settings.fontSize}px`);
        if (elements.fontSizeSlider) {
            elements.fontSizeSlider.value = settings.fontSize;
            elements.fontSizeValue.textContent = `${settings.fontSize}px`;
        }

        // Apply sidebar collapsed state
        if (settings.sidebarCollapsed && elements.sidebar) {
            elements.sidebar.classList.add('collapsed');
        }
        if (elements.sidebarCollapsedToggle) {
            elements.sidebarCollapsedToggle.checked = settings.sidebarCollapsed;
        }
    }

    // Update theme toggle buttons in settings
    function updateThemeButtons() {
        document.querySelectorAll('.settings-option[data-theme]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === settings.theme);
        });
    }

    // Setup event listeners
    function setupEventListeners() {
        // Settings button
        if (elements.settingsBtn) {
            elements.settingsBtn.addEventListener('click', () => {
                elements.settingsModal.classList.add('active');
            });
        }

        // Close settings modal
        if (elements.closeSettingsModal) {
            elements.closeSettingsModal.addEventListener('click', () => {
                elements.settingsModal.classList.remove('active');
            });
        }

        // Click outside modal to close
        if (elements.settingsModal) {
            elements.settingsModal.addEventListener('click', (e) => {
                if (e.target === elements.settingsModal) {
                    elements.settingsModal.classList.remove('active');
                }
            });
        }

        // Theme options
        document.querySelectorAll('.settings-option[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.theme = btn.dataset.theme;
                localStorage.setItem('theme', settings.theme);
                document.documentElement.dataset.theme = settings.theme;
                updateThemeButtons();
            });
        });

        // Font size slider
        if (elements.fontSizeSlider) {
            elements.fontSizeSlider.addEventListener('input', (e) => {
                settings.fontSize = parseInt(e.target.value);
                localStorage.setItem('fontSize', settings.fontSize);
                document.documentElement.style.setProperty('--note-font-size', `${settings.fontSize}px`);
                elements.fontSizeValue.textContent = `${settings.fontSize}px`;
            });
        }

        // Sidebar collapsed toggle
        if (elements.sidebarCollapsedToggle) {
            elements.sidebarCollapsedToggle.addEventListener('change', (e) => {
                settings.sidebarCollapsed = e.target.checked;
                localStorage.setItem('sidebarCollapsed', settings.sidebarCollapsed);
                elements.sidebar.classList.toggle('collapsed', settings.sidebarCollapsed);
            });
        }

        // Desktop sidebar toggle
        if (elements.sidebarToggle) {
            elements.sidebarToggle.addEventListener('click', () => {
                if (window.innerWidth > 768) {
                    elements.sidebar.classList.toggle('collapsed');
                    settings.sidebarCollapsed = elements.sidebar.classList.contains('collapsed');
                    localStorage.setItem('sidebarCollapsed', settings.sidebarCollapsed);
                    if (elements.sidebarCollapsedToggle) {
                        elements.sidebarCollapsedToggle.checked = settings.sidebarCollapsed;
                    }
                }
            });
        }

        // Welcome popup dismiss
        if (elements.dismissWelcome) {
            elements.dismissWelcome.addEventListener('click', () => {
                elements.welcomePopup.classList.remove('active');
                localStorage.setItem('hasVisited', 'true');
                settings.hasVisited = true;
            });
        }

        // Click outside welcome popup to dismiss
        if (elements.welcomePopup) {
            elements.welcomePopup.addEventListener('click', (e) => {
                if (e.target === elements.welcomePopup) {
                    elements.welcomePopup.classList.remove('active');
                    localStorage.setItem('hasVisited', 'true');
                    settings.hasVisited = true;
                }
            });
        }

        // Escape key to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (elements.settingsModal.classList.contains('active')) {
                    elements.settingsModal.classList.remove('active');
                }
                if (elements.welcomePopup.classList.contains('active')) {
                    elements.welcomePopup.classList.remove('active');
                    localStorage.setItem('hasVisited', 'true');
                    settings.hasVisited = true;
                }
            }
        });
    }

    // Expose settings for other modules
    window.clinicalVaultSettings = settings;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
