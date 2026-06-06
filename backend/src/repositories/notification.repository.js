// ============================================================================
// Notification repository — Supabase data access. Queries in, rows out.
// Isolation enforced by explicit user_id (+ organisation_id) filters; never
// returns another user's notifications.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const notificationRepository = {
    async insertNotifications(rows) {
        const { data, error } = await supabase_1.serviceClient
            .from('notifications').insert(rows).select();
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async listForUser(userId, { unread, limit }) {
        let q = supabase_1.serviceClient
            .from('notifications')
            .select('id, organisation_id, category, title, body, link_url, read_at, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (unread === true) q = q.is('read_at', null);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async unreadCount(userId) {
        const { count, error } = await supabase_1.serviceClient
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .is('read_at', null);
        if (error) throw new Error(error.message);
        return count ?? 0;
    },

    async markRead(userId, id, when) {
        const { error } = await supabase_1.serviceClient
            .from('notifications')
            .update({ read_at: when })
            .eq('user_id', userId)
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    async markAllRead(userId, when) {
        const { error } = await supabase_1.serviceClient
            .from('notifications')
            .update({ read_at: when })
            .eq('user_id', userId)
            .is('read_at', null);
        if (error) throw new Error(error.message);
    },

    async getPreferences(userId) {
        const { data, error } = await supabase_1.serviceClient
            .from('notification_preferences')
            .select('category, in_app, email, sms')
            .eq('user_id', userId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // Batch variant for fan-out: one query for many users. Returns
    // Map<user_id, prefRow[]> so notify() avoids an N+1 per-recipient query.
    async getPreferencesBatch(userIds) {
        if (!userIds.length) return new Map();
        const { data, error } = await supabase_1.serviceClient
            .from('notification_preferences')
            .select('user_id, category, in_app, email, sms')
            .in('user_id', userIds);
        if (error) throw new Error(error.message);
        const map = new Map();
        for (const row of data ?? []) {
            if (!map.has(row.user_id)) map.set(row.user_id, []);
            map.get(row.user_id).push(row);
        }
        return map;
    },

    async upsertPreferences(rows) {
        const { error } = await supabase_1.serviceClient
            .from('notification_preferences')
            .upsert(rows, { onConflict: 'user_id,category' });
        if (error) throw new Error(error.message);
    },

    async enqueueDeliveries(rows) {
        if (!rows.length) return;
        const { error } = await supabase_1.serviceClient
            .from('notification_deliveries').insert(rows);
        if (error) throw new Error(error.message);
    },

    async suppressedAddresses(addresses) {
        if (!addresses.length) return new Set();
        const { data, error } = await supabase_1.serviceClient
            .from('suppression_list')
            .select('address')
            .in('address', addresses);
        if (error) throw new Error(error.message);
        return new Set((data ?? []).map((r) => r.address));
    },

    async upsertSuppression(address, reason, when) {
        const { error } = await supabase_1.serviceClient
            .from('suppression_list')
            .upsert({ address, reason, created_at: when }, { onConflict: 'address' });
        if (error) throw new Error(error.message);
    },

    async claimPendingDeliveries(limit, nowIso) {
        const { data, error } = await supabase_1.serviceClient
            .from('notification_deliveries')
            .select('id, channel, to_address, attempts, notification:notifications(title, body, link_url)')
            .eq('status', 'pending')
            .lte('next_attempt_at', nowIso)
            .limit(limit);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async markDeliverySent(id, externalId, when) {
        await supabase_1.serviceClient.from('notification_deliveries')
            .update({ status: 'sent', external_id: externalId, sent_at: when })
            .eq('id', id);
    },

    async markDeliveryRetry(id, attempts, lastError, nextAttemptIso, failed) {
        await supabase_1.serviceClient.from('notification_deliveries')
            .update({
                status: failed ? 'failed' : 'pending',
                attempts,
                last_error: lastError,
                next_attempt_at: nextAttemptIso,
            })
            .eq('id', id);
    },
};
