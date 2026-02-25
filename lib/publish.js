/**
 * Publish/visibility helpers for note frontmatter and role-aware access control.
 */

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return false;
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function roleRank(role) {
    switch (role) {
    case 'viewer': return 1;
    case 'editor': return 2;
    case 'admin': return 3;
    case 'owner': return 4;
    default: return 0;
    }
}

function canPreview(role, user) {
    if (user?.role === 'admin') return true;
    return roleRank(role) >= roleRank('editor');
}

function computePublishState(frontmatter = {}, nowDate = new Date()) {
    const now = nowDate instanceof Date ? nowDate : new Date(nowDate);
    const isDraft = parseBoolean(frontmatter.draft);
    const isPrivate = parseBoolean(frontmatter.private);
    const isUnlisted = parseBoolean(frontmatter.unlisted);
    const publishedAtDate = parseDate(frontmatter.published_at);

    return {
        visibility: isPrivate ? 'private' : 'public',
        isDraft,
        isUnlisted,
        publishedAt: publishedAtDate ? publishedAtDate.toISOString() : null,
        unpublishedAt: null,
        isScheduled: Boolean(publishedAtDate && publishedAtDate.getTime() > now.getTime())
    };
}

function canAccessNote(publishState, user, vaultRole) {
    const state = publishState || computePublishState({});

    if (state.isDraft || state.isScheduled) {
        return canPreview(vaultRole, user);
    }

    if (state.visibility === 'private' || state.isUnlisted) {
        if (user?.role === 'admin') return true;
        return roleRank(vaultRole) >= roleRank('viewer');
    }

    return true;
}

function isNoteListable(publishState, user, vaultRole) {
    const state = publishState || computePublishState({});

    if (!canAccessNote(state, user, vaultRole)) {
        return false;
    }

    if (state.isDraft || state.isScheduled || state.isUnlisted) {
        return false;
    }

    return true;
}

function isPubliclyVisible(publishState) {
    const state = publishState || computePublishState({});
    return state.visibility === 'public' && !state.isDraft && !state.isScheduled && !state.isUnlisted;
}

module.exports = {
    computePublishState,
    canAccessNote,
    isNoteListable,
    isPubliclyVisible,
    roleRank,
    canPreview
};
