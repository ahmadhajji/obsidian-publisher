const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ensureAnonymousSession,
    applySecurityHeaders,
    createInMemoryRateLimiter
} = require('../server');

function createRes() {
    const headers = new Map();

    return {
        headers,
        statusCode: 200,
        payload: null,
        setHeader(name, value) {
            headers.set(name.toLowerCase(), value);
        },
        set(name, value) {
            this.setHeader(name, value);
        },
        getHeader(name) {
            return headers.get(name.toLowerCase());
        },
        cookie(name, value, options) {
            this.cookies = this.cookies || [];
            this.cookies.push({ name, value, options });
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
}

test('ensureAnonymousSession sets session cookie when missing', () => {
    const req = { cookies: {} };
    const res = createRes();

    ensureAnonymousSession(req, res, () => {});

    assert.ok(req.sessionId);
    assert.equal(Array.isArray(res.cookies), true);
    assert.equal(res.cookies[0].name, 'session_id');
});

test('applySecurityHeaders attaches strict baseline headers', () => {
    const req = {};
    const res = createRes();

    applySecurityHeaders(req, res, () => {});

    assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    assert.equal(res.getHeader('x-frame-options'), 'DENY');
    assert.match(res.getHeader('content-security-policy'), /default-src 'self'/);
});

test('createInMemoryRateLimiter blocks after max requests', () => {
    const limiter = createInMemoryRateLimiter({
        windowMs: 60_000,
        max: 2,
        keyPrefix: 'test'
    });

    const req = { ip: '127.0.0.1' };

    const res1 = createRes();
    const res2 = createRes();
    const res3 = createRes();

    limiter(req, res1, () => {});
    limiter(req, res2, () => {});
    limiter(req, res3, () => {});

    assert.equal(res3.statusCode, 429);
    assert.equal(res3.payload.error, 'Too many requests. Try again later.');
});
