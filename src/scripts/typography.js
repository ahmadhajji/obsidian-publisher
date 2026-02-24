/**
 * Typography Settings - User-configurable reading preferences
 */

class TypographySettings {
    constructor() {
        this.emojiFallback = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

        this.defaults = {
            fontFamily: 'Inter',
            fontSize: 16,
            lineHeight: 1.7,
            contentWidth: 720,
            paragraphSpacing: 1.5
        };

        this.fonts = [
            { name: 'Inter', value: 'Inter, sans-serif' },
            { name: 'Georgia', value: 'Georgia, serif' },
            { name: 'Merriweather', value: 'Merriweather, serif' },
            { name: 'Source Sans Pro', value: 'Source Sans Pro, sans-serif' },
            { name: 'Roboto', value: 'Roboto, sans-serif' },
            { name: 'Lora', value: 'Lora, serif' },
            { name: 'Open Sans', value: 'Open Sans, sans-serif' },
            { name: 'System Default', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }
        ];

        this.settings = this.loadSettings();
        this.panelVisible = false;
    }

    init() {
        this.applySettings();
        this.createPanel();
        this.createToggleButton();
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('obsidian-publisher-typography');
            return saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
        } catch {
            return { ...this.defaults };
        }
    }

    saveSettings() {
        localStorage.setItem('obsidian-publisher-typography', JSON.stringify(this.settings));

        // Also save to server if logged in
        if (window.obsidianPublisher?.state?.user) {
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ settings: { typography: this.settings } })
            }).catch(console.error);
        }
    }

    applySettings() {
        const root = document.documentElement;

        // Apply CSS custom properties
        const fontWithEmojiFallback = `${this.getFontValue(this.settings.fontFamily)}, ${this.emojiFallback}`;
        root.style.setProperty('--typography-font', fontWithEmojiFallback);
        root.style.setProperty('--typography-size', `${this.settings.fontSize}px`);
        root.style.setProperty('--typography-line-height', this.settings.lineHeight);
        root.style.setProperty('--typography-content-width', `${this.settings.contentWidth}px`);
        root.style.setProperty('--typography-paragraph-spacing', `${this.settings.paragraphSpacing}em`);
    }

    getFontValue(fontName) {
        const font = this.fonts.find(f => f.name === fontName);
        return font ? font.value : this.fonts[0].value;
    }

    createToggleButton() {
        const toolbar = document.querySelector('.toolbar');
        if (!toolbar) return;

        const btn = document.createElement('button');
        btn.id = 'typographyToggle';
        btn.className = 'toolbar-btn';
        btn.title = 'Typography Settings';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 7V4h16v3"/>
                <path d="M9 20h6"/>
                <path d="M12 4v16"/>
            </svg>
        `;

        btn.addEventListener('click', () => this.togglePanel());
        toolbar.insertBefore(btn, toolbar.firstChild);
    }

    createPanel() {
        const panel = document.createElement('div');
        panel.id = 'typographyPanel';
        panel.className = 'typography-panel';
        panel.innerHTML = `
            <div class="typography-header">
                <h3>Reading Settings</h3>
                <button class="typography-close" aria-label="Close">×</button>
            </div>
            
            <div class="typography-section">
                <label>Font Family</label>
                <select id="typFontFamily">
                    ${this.fonts.map(f =>
            `<option value="${f.name}" ${this.settings.fontFamily === f.name ? 'selected' : ''}>${f.name}</option>`
        ).join('')}
                </select>
            </div>
            
            <div class="typography-section">
                <label>Font Size: <span id="typFontSizeValue">${this.settings.fontSize}px</span></label>
                <input type="range" id="typFontSize" min="12" max="24" value="${this.settings.fontSize}">
            </div>
            
            <div class="typography-section">
                <label>Line Height: <span id="typLineHeightValue">${this.settings.lineHeight}</span></label>
                <input type="range" id="typLineHeight" min="1.2" max="2.2" step="0.1" value="${this.settings.lineHeight}">
            </div>
            
            <div class="typography-section">
                <label>Content Width: <span id="typWidthValue">${this.settings.contentWidth}px</span></label>
                <input type="range" id="typWidth" min="500" max="1000" step="20" value="${this.settings.contentWidth}">
            </div>
            
            <div class="typography-section">
                <label>Paragraph Spacing: <span id="typSpacingValue">${this.settings.paragraphSpacing}em</span></label>
                <input type="range" id="typSpacing" min="0.5" max="3" step="0.25" value="${this.settings.paragraphSpacing}">
            </div>
            
            <div class="typography-actions">
                <button id="typReset" class="btn-secondary">Reset to Default</button>
            </div>
        `;

        document.body.appendChild(panel);

        // Event listeners
        panel.querySelector('.typography-close').addEventListener('click', () => this.hidePanel());

        panel.querySelector('#typFontFamily').addEventListener('change', (e) => {
            this.settings.fontFamily = e.target.value;
            this.applySettings();
            this.saveSettings();
        });

        panel.querySelector('#typFontSize').addEventListener('input', (e) => {
            this.settings.fontSize = parseInt(e.target.value);
            panel.querySelector('#typFontSizeValue').textContent = `${this.settings.fontSize}px`;
            this.applySettings();
        });
        panel.querySelector('#typFontSize').addEventListener('change', () => this.saveSettings());

        panel.querySelector('#typLineHeight').addEventListener('input', (e) => {
            this.settings.lineHeight = parseFloat(e.target.value);
            panel.querySelector('#typLineHeightValue').textContent = this.settings.lineHeight.toFixed(1);
            this.applySettings();
        });
        panel.querySelector('#typLineHeight').addEventListener('change', () => this.saveSettings());

        panel.querySelector('#typWidth').addEventListener('input', (e) => {
            this.settings.contentWidth = parseInt(e.target.value);
            panel.querySelector('#typWidthValue').textContent = `${this.settings.contentWidth}px`;
            this.applySettings();
        });
        panel.querySelector('#typWidth').addEventListener('change', () => this.saveSettings());

        panel.querySelector('#typSpacing').addEventListener('input', (e) => {
            this.settings.paragraphSpacing = parseFloat(e.target.value);
            panel.querySelector('#typSpacingValue').textContent = `${this.settings.paragraphSpacing}em`;
            this.applySettings();
        });
        panel.querySelector('#typSpacing').addEventListener('change', () => this.saveSettings());

        panel.querySelector('#typReset').addEventListener('click', () => {
            this.settings = { ...this.defaults };
            this.applySettings();
            this.saveSettings();
            this.updatePanelValues();
        });
    }

    updatePanelValues() {
        const panel = document.getElementById('typographyPanel');
        if (!panel) return;

        panel.querySelector('#typFontFamily').value = this.settings.fontFamily;
        panel.querySelector('#typFontSize').value = this.settings.fontSize;
        panel.querySelector('#typFontSizeValue').textContent = `${this.settings.fontSize}px`;
        panel.querySelector('#typLineHeight').value = this.settings.lineHeight;
        panel.querySelector('#typLineHeightValue').textContent = this.settings.lineHeight.toFixed(1);
        panel.querySelector('#typWidth').value = this.settings.contentWidth;
        panel.querySelector('#typWidthValue').textContent = `${this.settings.contentWidth}px`;
        panel.querySelector('#typSpacing').value = this.settings.paragraphSpacing;
        panel.querySelector('#typSpacingValue').textContent = `${this.settings.paragraphSpacing}em`;
    }

    togglePanel() {
        this.panelVisible ? this.hidePanel() : this.showPanel();
    }

    showPanel() {
        const panel = document.getElementById('typographyPanel');
        if (panel) {
            panel.classList.add('visible');
            this.panelVisible = true;
        }
    }

    hidePanel() {
        const panel = document.getElementById('typographyPanel');
        if (panel) {
            panel.classList.remove('visible');
            this.panelVisible = false;
        }
    }
}

// Create singleton instance
window.typographySettings = new TypographySettings();
