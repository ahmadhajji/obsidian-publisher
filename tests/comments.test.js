const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

test('comments resolve/reopen permissions and mention extraction', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-publisher-comments-'));
    const dbPath = path.join(tmpDir, 'comments.db');
    process.env.DATABASE_PATH = dbPath;

    const dbModule = loadFresh('../lib/db');
    const comments = loadFresh('../lib/comments');

    dbModule.db.prepare(`
        INSERT INTO users (id, email, password_hash, display_name, role, is_blocked)
        VALUES
            ('u1', 'owner@example.com', '', 'Owner', 'member', 0),
            ('u2', 'reader@example.com', '', 'Reader', 'member', 0),
            ('u3', 'mod@example.com', '', 'Moderator', 'moderator', 0)
    `).run();

    const created = comments.createComment(
        'drive-note-1',
        'u1',
        'ping @reader and @mod',
        true,
        null,
        { selectionStart: 5, selectionEnd: 15, selectionText: 'selected text' }
    );

    assert.ok(created.id);
    assert.deepEqual(comments.extractMentions('hello @reader @mod'), ['reader', 'mod']);

    assert.throws(() => {
        comments.resolveComment(created.id, { id: 'u2', role: 'member' });
    }, /Not authorized/);

    comments.resolveComment(created.id, { id: 'u1', role: 'member' });
    let row = dbModule.statements.getCommentById.get(created.id);
    assert.equal(row.is_resolved, 1);

    comments.reopenComment(created.id, { id: 'u3', role: 'moderator', canModerate: true });
    row = dbModule.statements.getCommentById.get(created.id);
    assert.equal(row.is_resolved, 0);

    dbModule.db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
