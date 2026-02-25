/**
 * Comments module - handles public/private threaded comments with inline anchors.
 */

const { v4: uuidv4 } = require('uuid');
const { statements } = require('./db');

function normalizeContext(input) {
    if (!input) {
        return { userId: null, role: null, canModerate: false };
    }

    if (typeof input === 'string') {
        return { userId: input, role: null, canModerate: false };
    }

    const role = input.role || null;
    const canModerate = role === 'admin' || role === 'moderator' || Boolean(input.canModerate);

    return {
        userId: input.userId || input.id || null,
        role,
        canModerate
    };
}

function extractMentions(content) {
    if (!content || typeof content !== 'string') return [];

    const mentions = new Set();
    const regex = /@([a-zA-Z0-9._-]{2,64})/g;
    let match = regex.exec(content);

    while (match) {
        mentions.add(match[1].toLowerCase());
        match = regex.exec(content);
    }

    return Array.from(mentions);
}

function resolveMentionUserIds(mentions) {
    const userIds = new Set();

    for (const mention of mentions) {
        const q = `%${mention}%`;
        const candidates = statements.searchUsersForMentions.all(q, q, q, mention, mention, 10);

        for (const candidate of candidates) {
            const display = String(candidate.display_name || '').toLowerCase();
            const email = String(candidate.email || '').toLowerCase();
            const local = email.includes('@') ? email.split('@')[0] : email;

            if (display === mention || local === mention || email === mention) {
                userIds.add(candidate.id);
                break;
            }
        }
    }

    return Array.from(userIds);
}

function parseSelection(selection = {}) {
    const start = Number(selection.selectionStart);
    const end = Number(selection.selectionEnd);
    const text = typeof selection.selectionText === 'string' ? selection.selectionText.trim() : '';

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || !text) {
        return {
            selectionStart: null,
            selectionEnd: null,
            selectionText: null
        };
    }

    return {
        selectionStart: start,
        selectionEnd: end,
        selectionText: text.slice(0, 800)
    };
}

function createComment(noteId, userId, content, isPublic = false, parentId = null, options = {}) {
    if (!content || content.trim().length === 0) {
        throw new Error('Comment content cannot be empty');
    }

    if (content.length > 5000) {
        throw new Error('Comment is too long (max 5000 characters)');
    }

    const commentId = uuidv4();
    const selection = parseSelection(options);

    statements.createComment.run(
        commentId,
        noteId,
        userId,
        content.trim(),
        isPublic ? 1 : 0,
        parentId,
        selection.selectionStart,
        selection.selectionEnd,
        selection.selectionText,
        0
    );

    const mentions = extractMentions(content);
    const mentionUserIds = resolveMentionUserIds(mentions);

    return {
        id: commentId,
        noteId,
        userId,
        content: content.trim(),
        isPublic,
        parentId,
        selectionStart: selection.selectionStart,
        selectionEnd: selection.selectionEnd,
        selectionText: selection.selectionText,
        isResolved: false,
        mentionUserIds,
        createdAt: new Date().toISOString()
    };
}

function getCommentsForNote(noteId, currentUser = null) {
    const context = normalizeContext(currentUser);
    const allComments = statements.getCommentsByNote.all(noteId);

    const filteredComments = allComments.filter((comment) => {
        if (comment.is_public) return true;
        if (context.canModerate) return true;
        if (context.userId && comment.user_id === context.userId) return true;
        return false;
    });

    return filteredComments.map((comment) => {
        const isOwn = context.userId === comment.user_id;
        return {
            id: comment.id,
            noteId: comment.note_id,
            userId: comment.user_id,
            displayName: comment.display_name || comment.email.split('@')[0],
            content: comment.content,
            isPublic: !!comment.is_public,
            parentId: comment.parent_id,
            isResolved: !!comment.is_resolved,
            selectionStart: Number.isInteger(comment.selection_start) ? comment.selection_start : null,
            selectionEnd: Number.isInteger(comment.selection_end) ? comment.selection_end : null,
            selectionText: comment.selection_text || null,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            isOwn,
            canResolve: isOwn || context.canModerate,
            canReopen: context.canModerate
        };
    });
}

function updateComment(commentId, userId, content, isPublic) {
    if (!content || content.trim().length === 0) {
        throw new Error('Comment content cannot be empty');
    }

    if (content.length > 5000) {
        throw new Error('Comment is too long (max 5000 characters)');
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

function deleteComment(commentId, userId) {
    const result = statements.deleteComment.run(commentId, userId);

    if (result.changes === 0) {
        throw new Error('Comment not found or not authorized');
    }

    return { success: true };
}

function resolveComment(commentId, actingUser) {
    const context = normalizeContext(actingUser);
    const comment = statements.getCommentById.get(commentId);

    if (!comment) {
        throw new Error('Comment not found');
    }

    const isOwn = context.userId && context.userId === comment.user_id;
    if (!isOwn && !context.canModerate) {
        throw new Error('Not authorized to resolve this thread');
    }

    statements.updateCommentResolution.run(1, commentId);
    return { success: true };
}

function reopenComment(commentId, actingUser) {
    const context = normalizeContext(actingUser);
    const comment = statements.getCommentById.get(commentId);

    if (!comment) {
        throw new Error('Comment not found');
    }

    const isOwn = context.userId && context.userId === comment.user_id;
    if (!isOwn && !context.canModerate) {
        throw new Error('Not authorized to reopen this thread');
    }

    statements.updateCommentResolution.run(0, commentId);
    return { success: true };
}

function getCommentById(commentId) {
    return statements.getCommentById.get(commentId) || null;
}

function threadComments(comments) {
    const commentMap = new Map();
    const rootComments = [];

    comments.forEach((comment) => {
        commentMap.set(comment.id, { ...comment, replies: [] });
    });

    comments.forEach((comment) => {
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
    extractMentions,
    resolveMentionUserIds,
    createComment,
    getCommentsForNote,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    getCommentById,
    threadComments
};
