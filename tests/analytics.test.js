const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

test('analytics updateTimeSpent enforces ownership and monotonic updates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-publisher-test-'));
    const dbPath = path.join(tmpDir, 'analytics.db');
    process.env.DATABASE_PATH = dbPath;

    const dbModule = loadFresh('../lib/db');
    const analytics = loadFresh('../lib/analytics');

    const viewId = analytics.recordPageView('drive-note-1', null, 'sess-a');

    analytics.updateTimeSpent(viewId, 30, { sessionId: 'sess-a' });
    analytics.updateTimeSpent(viewId, 20, { sessionId: 'sess-a' });

    const view = dbModule.statements.getPageViewById.get(viewId);
    assert.equal(view.time_spent_seconds, 30);

    assert.throws(() => {
        analytics.updateTimeSpent(viewId, 40, { sessionId: 'sess-b' });
    }, /Not authorized/);

    dbModule.db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
