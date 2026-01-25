/**
 * Comments UI - Displays and manages comments on notes
 */

class CommentsUI {
    constructor() {
        this.currentNoteId = null;
        this.comments = [];
    }

    init() {
        this.createCommentsSection();
    }

    createCommentsSection() {
        // Will be injected into note content area
    }

    async loadComments(noteId) {
        this.currentNoteId = noteId;

        try {
            const response = await fetch(`/api/notes/${noteId}/comments`, {
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
        const commentCount = this.countComments(this.comments);

        container.innerHTML = `
            <div class="comments-header">
                <h3>Comments (${commentCount})</h3>
            </div>
            
            ${user ? `
                <form class="comment-form" id="newCommentForm">
                    <textarea placeholder="Add a comment..." required></textarea>
                    <div class="comment-form-actions">
                        <label class="comment-visibility">
                            <input type="checkbox" id="commentPublic">
                            <span>Make public</span>
                        </label>
                        <button type="submit" class="btn-primary">Post</button>
                    </div>
                </form>
            ` : `
                <p class="comments-login-notice">
                    <a href="#" id="commentLoginLink">Sign in</a> to leave a comment
                </p>
            `}
            
            <div class="comments-list" id="commentsList">
                ${this.renderComments(this.comments)}
            </div>
        `;

        // Event listeners
        if (user) {
            container.querySelector('#newCommentForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitComment(e.target);
            });
        } else {
            container.querySelector('#commentLoginLink')?.addEventListener('click', (e) => {
                e.preventDefault();
                window.authUI.showModal('login');
            });
        }

        // Reply buttons
        container.querySelectorAll('.comment-reply-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showReplyForm(btn.dataset.commentId));
        });

        // Delete buttons
        container.querySelectorAll('.comment-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteComment(btn.dataset.commentId));
        });

        // Toggle visibility buttons
        container.querySelectorAll('.comment-toggle-visibility').forEach(btn => {
            btn.addEventListener('click', () => this.toggleVisibility(btn.dataset.commentId, btn.dataset.public === 'true'));
        });
    }

    renderComments(comments, level = 0) {
        if (!comments || comments.length === 0) {
            return level === 0 ? '<p class="no-comments">No comments yet</p>' : '';
        }

        const user = window.obsidianPublisher?.state?.user;

        return comments.map(comment => `
            <div class="comment ${level > 0 ? 'comment-reply' : ''}" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <span class="comment-author">${this.escapeHtml(comment.displayName)}</span>
                    <span class="comment-date">${this.formatDate(comment.createdAt)}</span>
                    ${!comment.isPublic ? '<span class="comment-private">Private</span>' : ''}
                </div>
                <div class="comment-content">${this.escapeHtml(comment.content)}</div>
                <div class="comment-actions">
                    ${user ? `
                        <button class="comment-reply-btn" data-comment-id="${comment.id}">Reply</button>
                    ` : ''}
                    ${comment.isOwn ? `
                        <button class="comment-toggle-visibility" data-comment-id="${comment.id}" data-public="${!comment.isPublic}">
                            Make ${comment.isPublic ? 'Private' : 'Public'}
                        </button>
                        <button class="comment-delete-btn" data-comment-id="${comment.id}">Delete</button>
                    ` : ''}
                </div>
                <div class="comment-replies">
                    ${this.renderComments(comment.replies, level + 1)}
                </div>
                <div class="reply-form-container" id="replyForm-${comment.id}"></div>
            </div>
        `).join('');
    }

    showReplyForm(parentId) {
        const container = document.getElementById(`replyForm-${parentId}`);
        if (!container) return;

        // Remove other reply forms
        document.querySelectorAll('.reply-form-container').forEach(el => {
            if (el.id !== `replyForm-${parentId}`) el.innerHTML = '';
        });

        container.innerHTML = `
            <form class="comment-form reply-form">
                <textarea placeholder="Write a reply..." required></textarea>
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

        container.querySelector('form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitComment(e.target, parentId);
        });

        container.querySelector('textarea').focus();
    }

    async submitComment(form, parentId = null) {
        const textarea = form.querySelector('textarea');
        const publicCheckbox = form.querySelector('input[type="checkbox"]');
        const content = textarea.value.trim();

        if (!content) return;

        try {
            const response = await fetch(`/api/notes/${this.currentNoteId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    content,
                    isPublic: publicCheckbox?.checked || false,
                    parentId
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to post comment');
            }

            // Reload comments
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
            // Find the comment to get its content
            const findComment = (comments) => {
                for (const c of comments) {
                    if (c.id === commentId) return c;
                    if (c.replies) {
                        const found = findComment(c.replies);
                        if (found) return found;
                    }
                }
                return null;
            };

            const comment = findComment(this.comments);
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

    countComments(comments) {
        let count = 0;
        for (const c of comments) {
            count++;
            if (c.replies) {
                count += this.countComments(c.replies);
            }
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

// Create singleton instance
window.commentsUI = new CommentsUI();
