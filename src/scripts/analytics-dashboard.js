/**
 * Analytics Dashboard - View stats and insights
 */

class AnalyticsDashboard {
    constructor() {
        this.visible = false;
        this.data = null;
    }

    init() {
        this.createDashboard();
    }

    createDashboard() {
        const panel = document.createElement('div');
        panel.id = 'analyticsDashboard';
        panel.className = 'analytics-dashboard';
        panel.innerHTML = `
            <div class="analytics-content">
                <div class="analytics-header">
                    <h2>Analytics</h2>
                    <button class="analytics-close">×</button>
                </div>
                <div class="analytics-body" id="analyticsBody">
                    <div class="analytics-loading">Loading...</div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        panel.querySelector('.analytics-close').addEventListener('click', () => this.hide());
        panel.addEventListener('click', (e) => {
            if (e.target === panel) this.hide();
        });
    }

    async show() {
        const panel = document.getElementById('analyticsDashboard');
        panel.classList.add('visible');
        this.visible = true;

        await this.loadData();
    }

    hide() {
        const panel = document.getElementById('analyticsDashboard');
        panel.classList.remove('visible');
        this.visible = false;
    }

    async loadData() {
        const body = document.getElementById('analyticsBody');
        body.innerHTML = '<div class="analytics-loading">Loading...</div>';

        try {
            const response = await fetch('/api/analytics/dashboard', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Failed to load analytics');
            }

            this.data = await response.json();
            this.render();
        } catch (error) {
            body.innerHTML = `<div class="analytics-error">${error.message}</div>`;
        }
    }

    render() {
        const body = document.getElementById('analyticsBody');
        const d = this.data;

        body.innerHTML = `
            <div class="analytics-stats">
                <div class="stat-card">
                    <div class="stat-value">${d.totalViews}</div>
                    <div class="stat-label">Total Views</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${d.viewsToday}</div>
                    <div class="stat-label">Views Today</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${d.viewsThisWeek}</div>
                    <div class="stat-label">This Week</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${d.uniqueVisitors}</div>
                    <div class="stat-label">Unique Visitors</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${this.formatTime(d.avgTimeSpent)}</div>
                    <div class="stat-label">Avg. Read Time</div>
                </div>
            </div>
            
            <div class="analytics-section">
                <h3>Views Over Time</h3>
                <div class="chart-container">
                    ${this.renderChart(d.viewsByDay)}
                </div>
            </div>
            
            <div class="analytics-section">
                <h3>Top Notes</h3>
                <div class="top-notes-list">
                    ${this.renderTopNotes(d.topNotes)}
                </div>
            </div>
        `;
    }

    renderChart(data) {
        if (!data || data.length === 0) {
            return '<p class="no-data">No data yet</p>';
        }

        const maxViews = Math.max(...data.map(d => d.views));

        return `
            <div class="chart-bars">
                ${data.slice(-14).map(d => `
                    <div class="chart-bar-container">
                        <div class="chart-bar" style="height: ${(d.views / maxViews) * 100}%">
                            <span class="chart-tooltip">${d.views} views</span>
                        </div>
                        <span class="chart-label">${this.formatChartDate(d.date)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderTopNotes(notes) {
        if (!notes || notes.length === 0) {
            return '<p class="no-data">No views recorded yet</p>';
        }

        const allNotes = window.obsidianPublisher?.state?.notes || [];

        return notes.map((n, i) => {
            const note = allNotes.find(no => no.id === n.note_id);
            const title = note?.title || n.note_id;

            return `
                <div class="top-note-item" data-note-id="${n.note_id}">
                    <span class="top-note-rank">${i + 1}</span>
                    <span class="top-note-title">${this.escapeHtml(title)}</span>
                    <span class="top-note-views">${n.view_count} views</span>
                </div>
            `;
        }).join('');
    }

    formatTime(seconds) {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }

    formatChartDate(dateStr) {
        const date = new Date(dateStr);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

/**
 * Reading History Panel
 */
class HistoryPanel {
    constructor() {
        this.visible = false;
    }

    init() {
        this.createPanel();
    }

    createPanel() {
        const panel = document.createElement('div');
        panel.id = 'historyPanel';
        panel.className = 'history-panel';
        panel.innerHTML = `
            <div class="history-content">
                <div class="history-header">
                    <h2>Reading History</h2>
                    <button class="history-close">×</button>
                </div>
                <div class="history-body" id="historyBody">
                    <div class="history-loading">Loading...</div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        panel.querySelector('.history-close').addEventListener('click', () => this.hide());
        panel.addEventListener('click', (e) => {
            if (e.target === panel) this.hide();
        });
    }

    async show() {
        const panel = document.getElementById('historyPanel');
        panel.classList.add('visible');
        this.visible = true;

        await this.loadHistory();
    }

    hide() {
        const panel = document.getElementById('historyPanel');
        panel.classList.remove('visible');
        this.visible = false;
    }

    async loadHistory() {
        const body = document.getElementById('historyBody');
        body.innerHTML = '<div class="history-loading">Loading...</div>';

        try {
            const response = await fetch('/api/reading/history', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Failed to load history');
            }

            const data = await response.json();
            this.render(data.history);
        } catch (error) {
            body.innerHTML = `<div class="history-error">${error.message}</div>`;
        }
    }

    render(history) {
        const body = document.getElementById('historyBody');
        const allNotes = window.obsidianPublisher?.state?.notes || [];

        if (!history || history.length === 0) {
            body.innerHTML = '<p class="no-history">No reading history yet</p>';
            return;
        }

        body.innerHTML = history.map(h => {
            const note = allNotes.find(n => n.id === h.note_id);
            if (!note) return '';

            const progress = Math.round(h.scroll_position * 100);

            return `
                <div class="history-item" data-note-id="${h.note_id}">
                    <div class="history-item-title">${this.escapeHtml(note.title)}</div>
                    <div class="history-item-meta">
                        <span class="history-date">${this.formatDate(h.last_read_at)}</span>
                        ${progress > 0 && progress < 100 ? `
                            <span class="history-progress">${progress}% read</span>
                        ` : progress >= 100 ? `
                            <span class="history-complete">Complete</span>
                        ` : ''}
                    </div>
                    ${progress > 0 && progress < 100 ? `
                        <div class="history-progress-bar">
                            <div class="history-progress-fill" style="width: ${progress}%"></div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Click handlers
        body.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const noteId = item.dataset.noteId;
                const note = allNotes.find(n => n.id === noteId);
                if (note) {
                    this.hide();
                    window.tabsManager.openTab(note);
                }
            });
        });
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;

        return date.toLocaleDateString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// Create singleton instances
window.analyticsDashboard = new AnalyticsDashboard();
window.historyPanel = new HistoryPanel();
