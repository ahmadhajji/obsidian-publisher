/**
 * Comments module - handles public and private comments on notes
 */

const { v4: uuidv4 } = require('uuid');
const { statements } = require('./db');

/**
 * Create a new comment
 */
function createComment(noteId, userId, content, isPublic = false, parentId = null) {
    if (!content || content.trim().length === 0) {
        throw new Error('Comment content cannot be empty');
    }

    if (content.length > 5000) {
        throw new Error('Comment is too long (max 5000 characters)');
    }

    const commentId = uuidv4();

    statements.createComment.run(
        commentId,
        noteId,
        userId,
        content.trim(),
        isPublic ? 1 : 0,
        parentId
    );

    return {
        id: commentId,
        noteId,
        userId,
        content: content.trim(),
        isPublic,
        parentId,
        createdAt: new Date().toISOString()
    };
}

/**
 * Get comments for a note
 * - Returns all comments for the note owner
 * - Returns only public comments + user's own comments for others
 */
function getCommentsForNote(noteId, currentUserId = null) {
    const allComments = statements.getCommentsByNote.all(noteId);

    // Filter based on user
    const filteredComments = allComments.filter(comment => {
        // Always show public comments
        if (comment.is_public) return true;
        // Show user's own private comments
        if (currentUserId && comment.user_id === currentUserId) return true;
        return false;
    });

    // Format comments
    return filteredComments.map(c => ({
        id: c.id,
        noteId: c.note_id,
        userId: c.user_id,
        displayName: c.display_name || c.email.split('@')[0],
        content: c.content,
        isPublic: !!c.is_public,
        parentId: c.parent_id,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        isOwn: currentUserId === c.user_id
    }));
}

/**
 * Update a comment (only owner can update)
 */
function updateComment(commentId, userId, content, isPublic) {
    if (!content || content.trim().length === 0) {
        throw new Error('Comment content cannot be empty');
    }

    const result = statements.updateComment.run(
        content.trim(),
        isPublic ? 1 : 0,
        commentId,
        userId
    );

    if (result.changes === 0) {
        throw new Error('Comment not found or not authorized');
    }

    return { success: true };
}

/**
 * Delete a comment (only owner can delete)
 */
function deleteComment(commentId, userId) {
    const result = statements.deleteComment.run(commentId, userId);

    if (result.changes === 0) {
        throw new Error('Comment not found or not authorized');
    }

    return { success: true };
}

/**
 * Organize comments into threaded structure
 */
function threadComments(comments) {
    const commentMap = new Map();
    const rootComments = [];

    // First pass: create map
    comments.forEach(comment => {
        commentMap.set(comment.id, { ...comment, replies: [] });
    });

    // Second pass: build tree
    comments.forEach(comment => {
        const node = commentMap.get(comment.id);
        if (comment.parentId && commentMap.has(comment.parentId)) {
            commentMap.get(comment.parentId).replies.push(node);
        } else {
            rootComments.push(node);
        }
    });

    return rootComments;
}

module.exports = {
    createComment,
    getCommentsForNote,
    updateComment,
    deleteComment,
    threadComments
};
