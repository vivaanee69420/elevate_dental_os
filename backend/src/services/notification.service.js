// ============================================================================
// Notification service — in-app insert (synchronous) + outbox fan-out.
// notify() accepts a recipients map { userId: { email, phone } }. Callers that
// only have ids should resolve addresses first (helper resolveRecipients()).
// ============================================================================
import { notificationRepository } from "../repositories/notification.repository.js";
import * as supabase_1 from "../lib/supabase.js";

// Channel defaults when the user has no stored preference for a category.
function defaultPref(category) {
    return { in_app: true, email: true, sms: category === 'integration' };
}

export const notificationService = {
    // Resolve { userId: {email, phone} } for tenant users from public.users.
    async resolveRecipients(userIds) {
        const { data } = await supabase_1.serviceClient
            .from('users').select('id, email, phone').in('id', userIds);
        const map = {};
        for (const u of data ?? []) map[u.id] = { email: u.email, phone: u.phone ?? null };
        return map;
    },

    async notify({ orgId = null, userIds, isPlatform = false, category, title, body = null, link = null, recipients }) {
        if (!userIds?.length) return;
        const addrMap = recipients || (await this.resolveRecipients(userIds));

        // 1. In-app rows (synchronous).
        const notifRows = userIds.map((uid) => ({
            organisation_id: orgId,
            user_id: uid,
            is_platform: isPlatform,
            category,
            title,
            body,
            link_url: link,
        }));
        const inserted = await notificationRepository.insertNotifications(notifRows);
        const idByUser = {};
        inserted.forEach((row) => { idByUser[row.user_id] = row.id; });

        // 2. Resolve prefs + suppression, then enqueue email/sms deliveries.
        const allEmails = userIds.map((u) => addrMap[u]?.email).filter(Boolean);
        const suppressed = await notificationRepository.suppressedAddresses(allEmails);

        const deliveries = [];
        for (const uid of userIds) {
            const prefs = await notificationRepository.getPreferences(uid);
            const pref = prefs.find((p) => p.category === category) || defaultPref(category);
            const addr = addrMap[uid] || {};
            const notifId = idByUser[uid];
            if (!notifId) continue;
            if (pref.email && addr.email && !suppressed.has(addr.email)) {
                deliveries.push({ notification_id: notifId, channel: 'email', to_address: addr.email });
            }
            if (pref.sms && addr.phone) {
                deliveries.push({ notification_id: notifId, channel: 'sms', to_address: addr.phone });
            }
        }
        await notificationRepository.enqueueDeliveries(deliveries);
        return inserted;
    },

    listInbox(userId, q) {
        return notificationRepository.listForUser(userId, q);
    },
    unreadCount(userId) {
        return notificationRepository.unreadCount(userId);
    },
    markRead(userId, id) {
        return notificationRepository.markRead(userId, id, new Date().toISOString());
    },
    markAllRead(userId) {
        return notificationRepository.markAllRead(userId, new Date().toISOString());
    },
    getPreferences(userId) {
        return notificationRepository.getPreferences(userId);
    },
    updatePreferences(userId, preferences) {
        const rows = preferences.map((p) => ({ user_id: userId, ...p }));
        return notificationRepository.upsertPreferences(rows);
    },
};
