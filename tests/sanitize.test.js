const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeRenderedHtml, escapeHtml } = require('../lib/sanitize');

test('sanitizeRenderedHtml removes script tags and inline event handlers', () => {
    const input = '<h1 onclick="alert(1)">Title</h1><script>alert(2)</script>';
    const output = sanitizeRenderedHtml(input);

    assert.equal(output.includes('<script>'), false);
    assert.equal(output.includes('onclick='), false);
    assert.equal(output.includes('<h1'), true);
});

test('sanitizeRenderedHtml neutralizes javascript URL attributes', () => {
    const input = '<a href="javascript:alert(1)">click</a><img src="vbscript:foo">';
    const output = sanitizeRenderedHtml(input);

    assert.match(output, /href="#"/);
    assert.match(output, /src="#"/);
});

test('escapeHtml escapes key HTML characters', () => {
    const escaped = escapeHtml(`<script>alert('xss')</script>`);
    assert.equal(escaped, '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;');
});
