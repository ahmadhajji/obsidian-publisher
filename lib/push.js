/**
 * Web Push helpers.
 */

const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { statements, queries } = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        vapidConfigured = true;
    } catch (error) {
        console.error('Failed to initialize VAPID configuration:', error.message);
    }
}

function isPushConfigured() {
    return vapidConfigured;
}

function getPublicVapidKey() {
    return VAPID_PUBLIC_KEY || null;
}

function normalizeSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object') {
        throw new Error('Invalid subscription payload');
    }

    const endpoint = String(subscription.endpoint || '').trim();
    const p256dh = String(subscription.keys?.p256dh || '').trim();
    const auth = String(subscription.keys?.auth || '').trim();

    if (!endpoint || !p256dh || !auth) {
        throw new Error('Invalid push subscription keys');
    }

    return {
        endpoint,
        keys: {
            p256dh,
            auth
        }
    };
}

function upsertPushSubscription(userId, subscription) {
    const normalized = normalizeSubscription(subscription);

    statements.deletePushSubscription.run(normalized.endpoint);
    statements.createPushSubscription.run(
        uuidv4(),
        userId,
        normalized.endpoint,
        normalized.keys.p256dh,
        normalized.keys.auth
    );

    return { success: true };
}

function removePushSubscription(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') {
        return { success: true };
    }

    statements.deletePushSubscription.run(endpoint);
    return { success: true };
}

function parseUserSettings(userId) {
    try {
        const row = statements.getSettings.get(userId);
        if (!row?.settings_json) return {};
        const parsed = JSON.parse(row.settings_json);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function isEventEnabledForUser(userId, eventKey) {
    const settings = parseUserSettings(userId);
    const pushConfig = settings?.push;
    if (!pushConfig || typeof pushConfig !== 'object') {
        return true;
    }

    if (pushConfig.enabled === false) {
        return false;
    }

    const value = pushConfig[eventKey];
    if (typeof value === 'boolean') {
        return value;
    }

    return true;
}

async function sendWebPush(subscriptionRow, payload) {
    const subscription = {
        endpoint: subscriptionRow.endpoint,
        keys: {
            p256dh: subscriptionRow.p256dh,
            auth: subscriptionRow.auth
        }
    };

    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return { ok: true };
    } catch (error) {
        // Drop invalid/expired subscriptions.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
            statements.deletePushSubscription.run(subscriptionRow.endpoint);
        }
        return { ok: false, error };
    }
}

async function sendPayloadToSubscriptions(subscriptions, payload) {
    if (!isPushConfigured()) {
        return { sent: 0, failed: subscriptions.length, skipped: true };
    }

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
        // eslint-disable-next-line no-await-in-loop
        const result = await sendWebPush(sub, payload);
        if (result.ok) {
            sent += 1;
        } else {
            failed += 1;
        }
    }

    return { sent, failed, skipped: false };
}

async function sendPayloadToAll(payload, eventKey = 'published') {
    const subscriptions = statements.getPushSubscriptions.all()
        .filter((sub) => isEventEnabledForUser(sub.user_id, eventKey));
    return sendPayloadToSubscriptions(subscriptions, payload);
}

async function sendPayloadToUsers(userIds, payload, eventKey = 'mentions') {
    const normalized = Array.from(new Set((userIds || []).filter(Boolean)));
    if (normalized.length === 0) {
        return { sent: 0, failed: 0, skipped: false };
    }

    const subscriptions = queries.getPushSubscriptionsForUserIds(normalized)
        .filter((sub) => isEventEnabledForUser(sub.user_id, eventKey));
    return sendPayloadToSubscriptions(subscriptions, payload);
}

async function notifyPublishedNotes(vault, notes) {
    const published = (notes || []).filter(Boolean);
    if (published.length === 0) {
        return { sent: 0, failed: 0, skipped: false };
    }

    let sent = 0;
    let failed = 0;

    for (const note of published.slice(0, 10)) {
        const payload = {
            title: `New note published: ${note.title}`,
            body: `${vault.name}: ${note.path}`,
            url: `/notes/${note.id}`
        };

        // eslint-disable-next-line no-await-in-loop
        const result = await sendPayloadToAll(payload, 'published');
        sent += result.sent;
        failed += result.failed;
    }

    return { sent, failed, skipped: false };
}

async function notifyCommentActivity({
    actorUserId,
    actorDisplayName,
    noteId,
    noteTitle,
    commentPreview,
    mentionUserIds = [],
    replyUserId = null
}) {
    const targets = new Set();

    for (const id of mentionUserIds) {
        if (id && id !== actorUserId) targets.add(id);
    }

    if (replyUserId && replyUserId !== actorUserId) {
        targets.add(replyUserId);
    }

    const userIds = Array.from(targets);
    if (userIds.length === 0) {
        return { sent: 0, failed: 0, skipped: false };
    }

    const payload = {
        title: `Comment update: ${noteTitle}`,
        body: `${actorDisplayName}: ${commentPreview}`,
        url: `/notes/${noteId}`
    };

    return sendPayloadToUsers(userIds, payload, 'mentions');
}

module.exports = {
    isPushConfigured,
    getPublicVapidKey,
    upsertPushSubscription,
    removePushSubscription,
    sendPayloadToAll,
    sendPayloadToUsers,
    notifyPublishedNotes,
    notifyCommentActivity
};
