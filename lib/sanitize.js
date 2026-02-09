/**
 * Lightweight HTML sanitization utilities.
 *
 * This is intentionally conservative for untrusted markdown-derived HTML.
 */

const DISALLOWED_TAGS = [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option'
];

const DISALLOWED_BLOCKS_REGEX = new RegExp(
    `<(?:${DISALLOWED_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${DISALLOWED_TAGS.join('|')})\\s*>`,
    'gi'
);

const DISALLOWED_SELF_CLOSING_REGEX = new RegExp(
    `<(?:${DISALLOWED_TAGS.join('|')})(?:\\s[^>]*)?\\/?\\s*>`,
    'gi'
);

function sanitizeUrlAttribute(value) {
    const normalized = String(value || '').trim();
    const lower = normalized.toLowerCase();

    if (
        lower.startsWith('javascript:') ||
        lower.startsWith('vbscript:') ||
        lower.startsWith('data:text/html')
    ) {
        return '#';
    }

    return normalized;
}

function sanitizeRenderedHtml(html) {
    if (!html) return '';

    let output = String(html);

    // Remove high-risk elements entirely.
    output = output.replace(DISALLOWED_BLOCKS_REGEX, '');
    output = output.replace(DISALLOWED_SELF_CLOSING_REGEX, '');

    // Remove inline event handlers (onload, onclick, ...).
    output = output.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    // Neutralize dangerous URL schemes for href/src.
    output = output.replace(
        /\s(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (full, attrName, attrValue, dquoteVal, squoteVal, bareVal) => {
            const raw = dquoteVal ?? squoteVal ?? bareVal ?? '';
            const safe = sanitizeUrlAttribute(raw);
            return ` ${attrName}="${safe}"`;
        }
    );

    return output;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    sanitizeRenderedHtml,
    escapeHtml
};
