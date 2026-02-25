/**
 * Comments UI - threaded comments with inline anchors, resolution, and mentions.
 */

class CommentsUI {
    constructor() {
        this.currentNoteId = null;
        this.comments = [];
        this.showResolved = false;
        this.activeSelection = null;
        this.mentionState = {
            textarea: null,
            query: '',
            results: []
        };
    }

    init() {
        this.bindGlobalSelectionTracking();
    }

    getCommentsEndpoint(noteId) {
        const vault = window.obsidianPublisher?.state?.currentVault;
        if (vault?.id) {
            return `/api/vaults/${encodeURIComponent(vault.id)}/notes/${encodeURIComponent(noteId)}/comments`;
        }
        return `/api/notes/${encodeURIComponent(noteId)}/comments`;
    }

    bindGlobalSelectionTracking() {
        document.addEventListener('mouseup', () => {
            const noteBody = document.getElementById('noteBody');
            if (!noteBody || !this.currentNoteId) return;

            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                this.activeSelection = null;
                this.renderSelectionBadge();
                return;
            }

            const range = selection.getRangeAt(0);
            if (range.collapsed) {
                this.activeSelection = null;
                this.renderSelectionBadge();
                return;
            }

            if (!noteBody.contains(range.commonAncestorContainer)) {
                return;
            }

            const text = selection.toString().trim();
            if (!text || text.length < 2) {
                this.activeSelection = null;
                this.renderSelectionBadge();
                return;
            }

            const offsets = this.getSelectionOffsets(noteBody, range);
            if (!offsets) return;

            this.activeSelection = {
                selectionStart: offsets.start,
                selectionEnd: offsets.end,
                selectionText: text.slice(0, 800)
            };
            this.renderSelectionBadge();
        });
    }

    getSelectionOffsets(container, range) {
        try {
            const preRange = document.createRange();
            preRange.selectNodeContents(container);
            preRange.setEnd(range.startContainer, range.startOffset);
            const start = preRange.toString().length;
            const length = range.toString().length;
            if (!Number.isInteger(start) || !Number.isInteger(length) || length <= 0) {
                return null;
            }

            return {
                start,
                end: start + length
            };
        } catch {
            return null;
        }
    }

    async loadComments(noteId) {
        if (!noteId) return;
        this.currentNoteId = noteId;

        try {
            const response = await fetch(this.getCommentsEndpoint(noteId), {
                credentials: 'include'
            });
            const data = await response.json();
            this.comments = data.comments || [];
            this.render();
        } catch (error) {
            console.error('Failed to load comments:', error);
        }
    }

    render() {
        let container = document.getElementById('commentsSection');

        if (!container) {
            container = document.createElement('div');
            container.id = 'commentsSection';
            container.className = 'comments-section';

            const noteBody = document.getElementById('noteBody');
            if (noteBody) {
                noteBody.parentNode.insertBefore(container, noteBody.nextSibling);
            }
        }

        const user = window.obsidianPublisher?.state?.user;
        const visibleComments = this.showResolved
            ? this.comments
            : this.filterResolved(this.comments);

        container.innerHTML = `
            <div class="comments-header">
                <h3>Comments (${this.countComments(this.comments)})</h3>
                <label class="comment-show-resolved">
                    <input type="checkbox" id="showResolvedComments" ${this.showResolved ? 'checked' : ''}>
                    <span>Show resolved</span>
                </label>
            </div>

            <div id="selectionBadge"></div>

            ${user ? `
                <form class="comment-form" id="newCommentForm">
                    <textarea placeholder="Add a comment... Use @name to mention" required></textarea>
                    <div class="mention-results" id="newCommentMentions"></div>
                    <div class="comment-form-actions">
                        <label class="comment-visibility">
                            <input type="checkbox" id="commentPublic">
                            <span>Make public</span>
                        </label>
                        <button type="button" class="btn-secondary" id="clearSelectionComment" ${this.activeSelection ? '' : 'disabled'}>
                            Clear selection
                        </button>
                        <button type="submit" class="btn-primary">Post</button>
                    </div>
                </form>
            ` : `
                <p class="comments-login-notice">
                    <a href="#" id="commentLoginLink">Sign in</a> to leave a comment
                </p>
            `}

            <div class="comments-list" id="commentsList">
                ${this.renderComments(visibleComments)}
            </div>
        `;

        this.renderSelectionBadge();

        container.querySelector('#showResolvedComments')?.addEventListener('change', (event) => {
            this.showResolved = !!event.target.checked;
            this.render();
        });

        if (user) {
            const form = container.querySelector('#newCommentForm');
            form?.addEventListener('submit', (event) => {
                event.preventDefault();
                this.submitComment(event.target);
            });

            container.querySelector('#clearSelectionComment')?.addEventListener('click', () => {
                this.activeSelection = null;
                this.renderSelectionBadge();
                container.querySelector('#clearSelectionComment').disabled = true;
            });

            const textarea = form?.querySelector('textarea');
            const mentionsEl = form?.querySelector('#newCommentMentions');
            if (textarea && mentionsEl) {
                this.bindMentionAutocomplete(textarea, mentionsEl);
            }
        } else {
            container.querySelector('#commentLoginLink')?.addEventListener('click', (event) => {
                event.preventDefault();
                window.authUI?.showModal();
            });
        }

        container.querySelectorAll('.comment-reply-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.showReplyForm(btn.dataset.commentId));
        });

        container.querySelectorAll('.comment-delete-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.deleteComment(btn.dataset.commentId));
        });

        container.querySelectorAll('.comment-toggle-visibility').forEach((btn) => {
            btn.addEventListener('click', () => this.toggleVisibility(btn.dataset.commentId, btn.dataset.public === 'true'));
        });

        container.querySelectorAll('.comment-resolve-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.resolveThread(btn.dataset.commentId));
        });

        container.querySelectorAll('.comment-reopen-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.reopenThread(btn.dataset.commentId));
        });

        container.querySelectorAll('.comment-jump-anchor').forEach((btn) => {
            btn.addEventListener('click', () => this.jumpToAnchor(btn.dataset.commentId));
        });
    }

    renderSelectionBadge() {
        const badge = document.getElementById('selectionBadge');
        if (!badge) return;

        if (!this.activeSelection) {
            badge.innerHTML = '';
            return;
        }

        badge.innerHTML = `
            <div class="comment-selection-badge">
                <strong>Commenting on selection:</strong>
                <span>${this.escapeHtml(this.activeSelection.selectionText)}</span>
            </div>
        `;
    }

    renderComments(comments, level = 0) {
        if (!comments || comments.length === 0) {
            return level === 0 ? '<p class="no-comments">No comments yet</p>' : '';
        }

        const user = window.obsidianPublisher?.state?.user;

        return comments.map((comment) => `
            <div class="comment ${level > 0 ? 'comment-reply' : ''} ${comment.isResolved ? 'comment-resolved' : ''}" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <span class="comment-author">${this.escapeHtml(comment.displayName)}</span>
                    <span class="comment-date">${this.formatDate(comment.createdAt)}</span>
                    ${!comment.isPublic ? '<span class="comment-private">Private</span>' : ''}
                    ${comment.isResolved ? '<span class="comment-resolved-pill">Resolved</span>' : ''}
                </div>
                <div class="comment-content">${this.escapeHtml(comment.content)}</div>
                ${comment.selectionText ? `
                    <button class="comment-jump-anchor" data-comment-id="${comment.id}" title="Jump to selected text">
                        ↳ ${this.escapeHtml(comment.selectionText.slice(0, 100))}
                    </button>
                ` : ''}
                <div class="comment-actions">
                    ${user ? `<button class="comment-reply-btn" data-comment-id="${comment.id}">Reply</button>` : ''}
                    ${comment.canResolve && !comment.isResolved
        ? `<button class="comment-resolve-btn" data-comment-id="${comment.id}">Resolve</button>`
        : ''}
                    ${comment.canReopen && comment.isResolved
        ? `<button class="comment-reopen-btn" data-comment-id="${comment.id}">Reopen</button>`
        : ''}
                    ${comment.isOwn ? `
                        <button class="comment-toggle-visibility" data-comment-id="${comment.id}" data-public="${!comment.isPublic}">
                            Make ${comment.isPublic ? 'Private' : 'Public'}
                        </button>
                        <button class="comment-delete-btn" data-comment-id="${comment.id}">Delete</button>
                    ` : ''}
                </div>
                <div class="comment-replies">${this.renderComments(comment.replies, level + 1)}</div>
                <div class="reply-form-container" id="replyForm-${comment.id}"></div>
            </div>
        `).join('');
    }

    filterResolved(comments) {
        return (comments || [])
            .filter((comment) => !comment.isResolved)
            .map((comment) => ({
                ...comment,
                replies: this.filterResolved(comment.replies || [])
            }));
    }

    showReplyForm(parentId) {
        const container = document.getElementById(`replyForm-${parentId}`);
        if (!container) return;

        document.querySelectorAll('.reply-form-container').forEach((element) => {
            if (element.id !== `replyForm-${parentId}`) element.innerHTML = '';
        });

        container.innerHTML = `
            <form class="comment-form reply-form">
                <textarea placeholder="Write a reply... Use @name to mention" required></textarea>
                <div class="mention-results"></div>
                <div class="comment-form-actions">
                    <label class="comment-visibility">
                        <input type="checkbox" class="replyPublic">
                        <span>Make public</span>
                    </label>
                    <button type="button" class="btn-secondary cancel-reply">Cancel</button>
                    <button type="submit" class="btn-primary">Reply</button>
                </div>
            </form>
        `;

        container.querySelector('.cancel-reply').addEventListener('click', () => {
            container.innerHTML = '';
        });

        const form = container.querySelector('form');
        const textarea = form.querySelector('textarea');
        const mentions = form.querySelector('.mention-results');
        this.bindMentionAutocomplete(textarea, mentions);

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.submitComment(event.target, parentId);
        });

        textarea.focus();
    }

    bindMentionAutocomplete(textarea, resultsContainer) {
        if (!textarea || !resultsContainer) return;

        let debounce = null;

        textarea.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(async () => {
                const match = textarea.value.match(/@([a-zA-Z0-9._-]{2,64})$/);
                if (!match) {
                    resultsContainer.innerHTML = '';
                    return;
                }

                const query = match[1];
                try {
                    const response = await fetch(`/api/users/mentions?q=${encodeURIComponent(query)}`, {
                        credentials: 'include'
                    });
                    if (!response.ok) {
                        resultsContainer.innerHTML = '';
                        return;
                    }

                    const data = await response.json();
                    const users = data.users || [];
                    if (!users.length) {
                        resultsContainer.innerHTML = '';
                        return;
                    }

                    resultsContainer.innerHTML = users.map((user) => `
                        <button type="button" class="mention-item" data-mention="${this.escapeHtml((user.displayName || user.email).replace(/\s+/g, ''))}">
                            <strong>${this.escapeHtml(user.displayName)}</strong>
                            <span>${this.escapeHtml(user.email)}</span>
                        </button>
                    `).join('');

                    resultsContainer.querySelectorAll('.mention-item').forEach((button) => {
                        button.addEventListener('click', () => {
                            const handle = button.dataset.mention;
                            textarea.value = textarea.value.replace(/@([a-zA-Z0-9._-]{2,64})$/, `@${handle} `);
                            textarea.focus();
                            resultsContainer.innerHTML = '';
                        });
                    });
                } catch {
                    resultsContainer.innerHTML = '';
                }
            }, 120);
        });
    }

    async submitComment(form, parentId = null) {
        const textarea = form.querySelector('textarea');
        const publicCheckbox = form.querySelector('input[type="checkbox"]');
        const content = textarea.value.trim();

        if (!content) return;

        try {
            const response = await fetch(this.getCommentsEndpoint(this.currentNoteId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    content,
                    isPublic: publicCheckbox?.checked || false,
                    parentId,
                    selectionStart: this.activeSelection?.selectionStart ?? null,
                    selectionEnd: this.activeSelection?.selectionEnd ?? null,
                    selectionText: this.activeSelection?.selectionText ?? null
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to post comment');
            }

            this.activeSelection = null;
            await this.loadComments(this.currentNoteId);
        } catch (error) {
            console.error('Error posting comment:', error);
            alert(error.message);
        }
    }

    async deleteComment(commentId) {
        if (!confirm('Delete this comment?')) return;

        try {
            const response = await fetch(`/api/comments/${commentId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Failed to delete comment');
            }

            await this.loadComments(this.currentNoteId);
        } catch (error) {
            console.error('Error deleting comment:', error);
            alert(error.message);
        }
    }

    async toggleVisibility(commentId, makePublic) {
        try {
            const comment = this.findComment(commentId, this.comments);
            if (!comment) return;

            const response = await fetch(`/api/comments/${commentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    content: comment.content,
                    isPublic: makePublic
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update comment');
            }

            await this.loadComments(this.currentNoteId);
        } catch (error) {
            console.error('Error updating comment:', error);
            alert(error.message);
        }
    }

    async resolveThread(commentId) {
        try {
            const response = await fetch(`/api/comments/${commentId}/resolve`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to resolve thread');
            }

            await this.loadComments(this.currentNoteId);
        } catch (error) {
            console.error('Error resolving comment:', error);
            alert(error.message);
        }
    }

    async reopenThread(commentId) {
        try {
            const response = await fetch(`/api/comments/${commentId}/reopen`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to reopen thread');
            }

            await this.loadComments(this.currentNoteId);
        } catch (error) {
            console.error('Error reopening comment:', error);
            alert(error.message);
        }
    }

    jumpToAnchor(commentId) {
        const comment = this.findComment(commentId, this.comments);
        if (!comment?.selectionText) return;

        const noteBody = document.getElementById('noteBody');
        if (!noteBody) return;

        const walker = document.createTreeWalker(noteBody, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();

        while (node) {
            const index = node.nodeValue.toLowerCase().indexOf(comment.selectionText.toLowerCase());
            if (index >= 0) {
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + comment.selectionText.length);

                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);

                const rect = range.getBoundingClientRect();
                const top = window.scrollY + rect.top - 120;
                window.scrollTo({ top, behavior: 'smooth' });
                return;
            }
            node = walker.nextNode();
        }
    }

    findComment(commentId, comments) {
        for (const comment of comments || []) {
            if (comment.id === commentId) return comment;
            const nested = this.findComment(commentId, comment.replies || []);
            if (nested) return nested;
        }
        return null;
    }

    countComments(comments) {
        let count = 0;
        for (const comment of comments || []) {
            count += 1;
            count += this.countComments(comment.replies || []);
        }
        return count;
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return date.toLocaleDateString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

window.commentsUI = new CommentsUI();
