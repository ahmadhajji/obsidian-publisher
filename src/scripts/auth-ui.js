/**
 * Auth UI - Login/Register modal and user state management
 */

class AuthUI {
    constructor() {
        this.user = null;
        this.modalVisible = false;
    }

    init() {
        this.createModal();
        this.createUserMenu();
        this.checkAuth();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            const data = await response.json();

            if (data.user) {
                this.setUser(data.user);
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
    }

    setUser(user) {
        this.user = user;
        window.obsidianPublisher.state.user = user;
        this.updateUI();
    }

    clearUser() {
        this.user = null;
        window.obsidianPublisher.state.user = null;
        this.updateUI();
    }

    updateUI() {
        const userBtn = document.getElementById('userMenuBtn');
        const userMenu = document.getElementById('userDropdown');

        if (this.user) {
            userBtn.innerHTML = `
                <span class="user-avatar">${this.user.displayName.charAt(0).toUpperCase()}</span>
            `;
            userBtn.title = this.user.displayName;

            document.getElementById('userDisplayName').textContent = this.user.displayName;
            document.getElementById('userEmail').textContent = this.user.email;
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
                <hr>
                <button id="logoutBtn" class="dropdown-item">Sign Out</button>
            </div>
        `;

        toolbar.appendChild(container);

        const userBtn = container.querySelector('#userMenuBtn');
        const dropdown = container.querySelector('#userDropdown');

        userBtn.addEventListener('click', () => {
            if (this.user) {
                dropdown.classList.toggle('visible');
            } else {
                this.showModal('login');
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
    }

    createModal() {
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'auth-modal';
        modal.innerHTML = `
            <div class="auth-modal-content">
                <button class="auth-modal-close">×</button>
                
                <div id="loginForm" class="auth-form">
                    <h2>Sign In</h2>
                    <form>
                        <div class="form-group">
                            <label for="loginEmail">Email</label>
                            <input type="email" id="loginEmail" required>
                        </div>
                        <div class="form-group">
                            <label for="loginPassword">Password</label>
                            <input type="password" id="loginPassword" required>
                        </div>
                        <div class="form-error" id="loginError"></div>
                        <button type="submit" class="btn-primary">Sign In</button>
                    </form>
                    <p class="auth-switch">
                        Don't have an account? <a href="#" id="showRegister">Sign Up</a>
                    </p>
                </div>
                
                <div id="registerForm" class="auth-form" style="display: none;">
                    <h2>Create Account</h2>
                    <form>
                        <div class="form-group">
                            <label for="registerName">Display Name</label>
                            <input type="text" id="registerName">
                        </div>
                        <div class="form-group">
                            <label for="registerEmail">Email</label>
                            <input type="email" id="registerEmail" required>
                        </div>
                        <div class="form-group">
                            <label for="registerPassword">Password</label>
                            <input type="password" id="registerPassword" required minlength="8">
                            <small>At least 8 characters</small>
                        </div>
                        <div class="form-error" id="registerError"></div>
                        <button type="submit" class="btn-primary">Create Account</button>
                    </form>
                    <p class="auth-switch">
                        Already have an account? <a href="#" id="showLogin">Sign In</a>
                    </p>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('.auth-modal-close').addEventListener('click', () => this.hideModal());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.hideModal();
        });

        modal.querySelector('#showRegister').addEventListener('click', (e) => {
            e.preventDefault();
            this.showModal('register');
        });

        modal.querySelector('#showLogin').addEventListener('click', (e) => {
            e.preventDefault();
            this.showModal('login');
        });

        // Login form
        modal.querySelector('#loginForm form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.login(
                document.getElementById('loginEmail').value,
                document.getElementById('loginPassword').value
            );
        });

        // Register form  
        modal.querySelector('#registerForm form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.register(
                document.getElementById('registerEmail').value,
                document.getElementById('registerPassword').value,
                document.getElementById('registerName').value
            );
        });
    }

    showModal(mode = 'login') {
        const modal = document.getElementById('authModal');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        loginForm.style.display = mode === 'login' ? 'block' : 'none';
        registerForm.style.display = mode === 'register' ? 'block' : 'none';

        modal.classList.add('visible');
        this.modalVisible = true;

        // Focus first input
        setTimeout(() => {
            const input = modal.querySelector(`#${mode}Email`);
            if (input) input.focus();
        }, 100);
    }

    hideModal() {
        const modal = document.getElementById('authModal');
        modal.classList.remove('visible');
        this.modalVisible = false;

        // Clear forms
        modal.querySelectorAll('input').forEach(input => input.value = '');
        modal.querySelectorAll('.form-error').forEach(err => err.textContent = '');
    }

    async login(email, password) {
        const errorEl = document.getElementById('loginError');
        errorEl.textContent = '';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            this.setUser(data.user);
            this.hideModal();
        } catch (error) {
            errorEl.textContent = error.message;
        }
    }

    async register(email, password, displayName) {
        const errorEl = document.getElementById('registerError');
        errorEl.textContent = '';

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password, displayName })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            this.setUser(data.user);
            this.hideModal();
        } catch (error) {
            errorEl.textContent = error.message;
        }
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
        // Trigger analytics dashboard
        if (window.analyticsDashboard) {
            window.analyticsDashboard.show();
        }
    }

    showHistory() {
        // Trigger history panel
        if (window.historyPanel) {
            window.historyPanel.show();
        }
    }
}

// Create singleton instance
window.authUI = new AuthUI();
