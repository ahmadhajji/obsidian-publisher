const test = require('node:test');
const assert = require('node:assert/strict');

const {
    computePublishState,
    canAccessNote,
    isNoteListable
} = require('../lib/publish');

test('computePublishState handles draft/private/unlisted/published_at', () => {
    const now = new Date('2026-02-25T00:00:00.000Z');
    const state = computePublishState({
        draft: true,
        private: true,
        unlisted: true,
        published_at: '2026-03-01T00:00:00.000Z'
    }, now);

    assert.equal(state.visibility, 'private');
    assert.equal(state.isDraft, true);
    assert.equal(state.isUnlisted, true);
    assert.equal(state.isScheduled, true);
    assert.equal(state.publishedAt, '2026-03-01T00:00:00.000Z');
});

test('canAccessNote enforces membership for private/unlisted and preview for drafts', () => {
    const privateNote = computePublishState({ private: true });
    const draftNote = computePublishState({ draft: true });

    assert.equal(canAccessNote(privateNote, null, null), false);
    assert.equal(canAccessNote(privateNote, { role: 'member' }, 'viewer'), true);

    assert.equal(canAccessNote(draftNote, { role: 'member' }, 'viewer'), false);
    assert.equal(canAccessNote(draftNote, { role: 'member' }, 'editor'), true);
});

test('isNoteListable excludes unlisted and scheduled notes', () => {
    const now = new Date('2026-02-25T00:00:00.000Z');
    const unlisted = computePublishState({ unlisted: true }, now);
    const scheduled = computePublishState({ published_at: '2026-03-10T00:00:00.000Z' }, now);
    const publicNote = computePublishState({}, now);

    assert.equal(isNoteListable(unlisted, { role: 'member' }, 'viewer'), false);
    assert.equal(isNoteListable(scheduled, { role: 'member' }, 'owner'), false);
    assert.equal(isNoteListable(publicNote, null, null), true);
});
