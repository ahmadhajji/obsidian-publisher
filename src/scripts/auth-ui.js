/**
 * Auth UI - OAuth login and user state management (V2 - Google OAuth)
 */

class AuthUI {
    constructor() {
        this.user = null;
        this.isAdmin = false;
        this.modalVisible = false;
        this.oauthConfig = null;
    }

    async init() {
        await this.loadOAuthConfig();
        this.createModal();
        this.createUserMenu();
        await this.checkAuth();
        this.checkForOAuthError();
    }

    async loadOAuthConfig() {
        try {
            const response = await fetch('/api/auth/config');
            this.oauthConfig = await response.json();
        } catch (error) {
            console.error('Failed to load OAuth config:', error);
            this.oauthConfig = { googleEnabled: false };
        }
    }

    checkForOAuthError() {
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        if (error) {
            // Show error message
            console.error('OAuth error:', error);
            // Clear error from URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            const data = await response.json();

            if (data.user) {
                this.setUser(data.user, data.isAdmin);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
    }

    setUser(user, isAdmin = false) {
        this.user = user;
        this.isAdmin = isAdmin;
        window.obsidianPublisher.state.user = user;
        this.updateUI();
    }

    clearUser() {
        this.user = null;
        this.isAdmin = false;
        window.obsidianPublisher.state.user = null;
        this.updateUI();
    }

    updateUI() {
        const userBtn = document.getElementById('userMenuBtn');
        const adminSection = document.getElementById('adminSection');

        if (this.user) {
            // Show avatar or initial
            if (this.user.avatarUrl) {
                userBtn.innerHTML = `<img class="user-avatar-img" src="${this.escapeAttribute(this.user.avatarUrl)}" alt="${this.escapeAttribute(this.user.displayName)}" referrerpolicy="no-referrer">`;
            } else {
                userBtn.innerHTML = `<span class="user-avatar">${this.escapeHtml(this.user.displayName.charAt(0).toUpperCase())}</span>`;
            }
            userBtn.title = this.user.displayName;

            document.getElementById('userDisplayName').textContent = this.user.displayName;
            document.getElementById('userEmail').textContent = this.user.email;

            // Show/hide admin section
            if (adminSection) {
                adminSection.style.display = this.isAdmin ? 'block' : 'none';
            }
        } else {
            userBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
            `;
            userBtn.title = 'Sign In';
        }
    }

    createUserMenu() {
        const toolbar = document.querySelector('.toolbar');
        if (!toolbar) return;

        const container = document.createElement('div');
        container.className = 'user-menu-container';
        container.innerHTML = `
            <button id="userMenuBtn" class="toolbar-btn user-btn" title="Sign In">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
            </button>
            <div id="userDropdown" class="user-dropdown">
                <div class="user-info">
                    <span id="userDisplayName"></span>
                    <span id="userEmail"></span>
                </div>
                <hr>
                <button id="analyticsBtn" class="dropdown-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 20V10M12 20V4M6 20v-6"/>
                    </svg>
                    Analytics
                </button>
                <button id="historyBtn" class="dropdown-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    Reading History
                </button>
                <div id="adminSection" style="display: none;">
                    <hr>
                    <button id="adminPanelBtn" class="dropdown-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        Admin Panel
                    </button>
                </div>
                <hr>
                <button id="logoutBtn" class="dropdown-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign Out
                </button>
            </div>
        `;

        toolbar.appendChild(container);

        const userBtn = container.querySelector('#userMenuBtn');
        const dropdown = container.querySelector('#userDropdown');

        userBtn.addEventListener('click', () => {
            if (this.user) {
                dropdown.classList.toggle('visible');
            } else {
                this.showModal();
            }
        });

        // Close dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.classList.remove('visible');
            }
        });

        container.querySelector('#logoutBtn').addEventListener('click', () => this.logout());
        container.querySelector('#analyticsBtn').addEventListener('click', () => {
            dropdown.classList.remove('visible');
            this.showAnalytics();
        });
        container.querySelector('#historyBtn').addEventListener('click', () => {
            dropdown.classList.remove('visible');
            this.showHistory();
        });
        container.querySelector('#adminPanelBtn').addEventListener('click', () => {
            dropdown.classList.remove('visible');
            this.showAdminPanel();
        });
    }

    createModal() {
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'auth-modal';
        modal.innerHTML = `
            <div class="auth-modal-content oauth-modal">
                <button class="auth-modal-close">×</button>
                
                <div class="oauth-header">
                    <div class="oauth-logo">
                        <svg width="48" height="48" viewBox="0 0 100 100">
                            <defs>
                                <linearGradient id="authGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#7c3aed"/>
                                    <stop offset="100%" stop-color="#a78bfa"/>
                                </linearGradient>
                            </defs>
                            <rect width="100" height="100" rx="20" fill="url(#authGrad)"/>
                            <circle cx="35" cy="25" r="8" stroke="white" stroke-width="5" fill="none"/>
                            <circle cx="65" cy="25" r="8" stroke="white" stroke-width="5" fill="none"/>
                            <path d="M35 33 L35 50 Q35 70 50 70 Q65 70 65 50 L65 33" stroke="white" stroke-width="5" fill="none" stroke-linecap="round"/>
                            <circle cx="50" cy="78" r="10" fill="white"/>
                        </svg>
                    </div>
                    <h2>Welcome to Clinical Vault</h2>
                    <p>Sign in to unlock comments, reading history, and more</p>
                </div>

                <div class="oauth-buttons">
                    <button id="googleSignInBtn" class="oauth-btn google-btn" ${!this.oauthConfig?.googleEnabled ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Continue with Google
                    </button>
                </div>

                <div class="oauth-footer">
                    <p>By signing in, you agree to our terms of use.</p>
                    <p class="oauth-note">Your data is private and secure.</p>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('.auth-modal-close').addEventListener('click', () => this.hideModal());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.hideModal();
        });

        // Google sign in
        modal.querySelector('#googleSignInBtn').addEventListener('click', () => {
            if (this.oauthConfig?.googleEnabled) {
                window.location.href = '/auth/google';
            }
        });
    }

    showModal() {
        const modal = document.getElementById('authModal');
        modal.classList.add('visible');
        this.modalVisible = true;
    }

    hideModal() {
        const modal = document.getElementById('authModal');
        modal.classList.remove('visible');
        this.modalVisible = false;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout error:', error);
        }

        this.clearUser();
        document.getElementById('userDropdown').classList.remove('visible');
    }

    showAnalytics() {
        if (window.analyticsDashboard) {
            window.analyticsDashboard.show();
        }
    }

    showHistory() {
        if (window.historyPanel) {
            window.historyPanel.show();
        }
    }

    showAdminPanel() {
        if (window.adminPanel) {
            window.adminPanel.show();
        } else {
            // Create admin panel dynamically if not exists
            this.createAdminPanel();
        }
    }

    createAdminPanel() {
        // Simple admin panel - can be expanded later
        const panel = document.createElement('div');
        panel.id = 'adminPanelModal';
        panel.className = 'modal-overlay active';
        panel.innerHTML = `
            <div class="modal" style="max-width: 800px;">
                <div class="modal-header">
                    <h3>Admin Panel</h3>
                    <button class="modal-close" id="closeAdminPanel">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="admin-tabs">
                        <button class="admin-tab active" data-tab="users">Users</button>
                        <button class="admin-tab" data-tab="feedback">Feedback</button>
                    </div>
                    <div id="adminContent" class="admin-content">
                        <p>Loading...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('#closeAdminPanel').addEventListener('click', () => panel.remove());
        panel.addEventListener('click', (e) => {
            if (e.target === panel) panel.remove();
        });

        // Tab switching
        panel.querySelectorAll('.admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.loadAdminTab(tab.dataset.tab);
            });
        });

        // Load users by default
        this.loadAdminTab('users');
    }

    async loadAdminTab(tab) {
        const content = document.getElementById('adminContent');
        content.innerHTML = '<p>Loading...</p>';

        try {
            if (tab === 'users') {
                const response = await fetch('/api/admin/users', { credentials: 'include' });
                const data = await response.json();
                content.innerHTML = this.renderUsersTable(data.users);
            } else if (tab === 'feedback') {
                const response = await fetch('/api/admin/feedback', { credentials: 'include' });
                const data = await response.json();
                content.innerHTML = this.renderFeedbackList(data.feedback);
            }
        } catch (error) {
            content.innerHTML = `<p class="error">Failed to load: ${this.escapeHtml(error.message)}</p>`;
        }
    }

    renderUsersTable(users) {
        if (!users || users.length === 0) return '<p>No users found.</p>';
        
        return `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr class="${u.is_blocked ? 'blocked' : ''}">
                            <td>
                                ${u.avatar_url ? `<img src="${this.escapeAttribute(u.avatar_url)}" class="admin-avatar" referrerpolicy="no-referrer">` : ''}
                                ${this.escapeHtml(u.display_name || 'Unknown')}
                            </td>
                            <td>${this.escapeHtml(u.email)}</td>
                            <td>
                                <select class="role-select" data-user-id="${this.escapeAttribute(u.id)}" ${u.id === this.user?.id ? 'disabled' : ''}>
                                    <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
                                    <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Moderator</option>
                                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                    <option value="blocked" ${u.role === 'blocked' ? 'selected' : ''}>Blocked</option>
                                </select>
                            </td>
                            <td>
                                ${u.is_blocked 
                                    ? `<button class="btn-secondary btn-sm" onclick="authUI.unblockUser('${this.escapeJsString(u.id)}')">Unblock</button>`
                                    : (u.id !== this.user?.id ? `<button class="btn-secondary btn-sm danger" onclick="authUI.blockUserAction('${this.escapeJsString(u.id)}')">Block</button>` : '')
                                }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderFeedbackList(feedback) {
        if (!feedback || feedback.length === 0) return '<p>No feedback yet.</p>';
        
        return `
            <div class="feedback-list">
                ${feedback.map(f => `
                    <div class="feedback-item ${f.is_read ? 'read' : 'unread'}">
                        <div class="feedback-header">
                            <span class="feedback-type">${this.escapeHtml(f.type)}</span>
                            <span class="feedback-email">${this.escapeHtml(f.email || 'Anonymous')}</span>
                            <span class="feedback-date">${new Date(f.created_at).toLocaleDateString()}</span>
                        </div>
                        <div class="feedback-message">${this.escapeHtml(f.message)}</div>
                        ${!f.is_read ? `<button class="btn-secondary btn-sm" onclick="authUI.markFeedbackRead('${this.escapeJsString(f.id)}')">Mark Read</button>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    escapeAttribute(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }

    escapeJsString(text) {
        return String(text || '').replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
    }

    async blockUserAction(userId) {
        if (!confirm('Are you sure you want to block this user?')) return;
        try {
            await fetch(`/api/admin/users/${userId}/block`, {
                method: 'POST',
                credentials: 'include'
            });
            this.loadAdminTab('users');
        } catch (error) {
            alert('Failed to block user');
        }
    }

    async unblockUser(userId) {
        try {
            await fetch(`/api/admin/users/${userId}/unblock`, {
                method: 'POST',
                credentials: 'include'
            });
            this.loadAdminTab('users');
        } catch (error) {
            alert('Failed to unblock user');
        }
    }

    async markFeedbackRead(feedbackId) {
        try {
            await fetch(`/api/admin/feedback/${feedbackId}/read`, {
                method: 'POST',
                credentials: 'include'
            });
            this.loadAdminTab('feedback');
        } catch (error) {
            alert('Failed to mark feedback');
        }
    }
}

// Create singleton instance
window.authUI = new AuthUI();
