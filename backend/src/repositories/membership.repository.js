// ============================================================================
// Multi-organisation membership. One login may belong to several accounts;
// users.organisation_id remains the HOME/default org and these rows are
// additive. Every acting-org decision is validated against this table on the
// request path — the client's chosen org is never trusted on its own.
// ============================================================================
import { serviceClient } from "../lib/supabase.js";

export const membershipRepository = {
    // Accounts this login can reach, named for the picker.
    async listForUser(userId) {
        const { data, error } = await serviceClient
            .from('user_organisations')
            .select('organisation_id, role, permissions, organisations(name)')
            .eq('user_id', userId);
        if (error) throw error;
        return (data ?? []).map((r) => ({
            organisation_id: r.organisation_id,
            name: r.organisations?.name ?? null,
            role: r.role,
            permissions: r.permissions ?? {},
        }));
    },

    async listForOrg(orgId) {
        const { data, error } = await serviceClient
            .from('user_organisations')
            .select('user_id, role, created_at')
            .eq('organisation_id', orgId);
        if (error) throw error;
        return data ?? [];
    },

    // Memberships for many users at once, scoped to the orgs the caller
    // administers. Paged for the same reason as listMembersForOrgs.
    async listForUsers(userIds, orgIds) {
        const out = new Map();
        if (!userIds?.length || !orgIds?.length) return out;
        const PAGE = 500;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await serviceClient
                .from('user_organisations')
                .select('user_id, organisation_id, role')
                .in('user_id', userIds)
                .in('organisation_id', orgIds)
                .order('user_id', { ascending: true })
                .order('organisation_id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const row of data) {
                if (!out.has(row.user_id)) out.set(row.user_id, []);
                out.get(row.user_id).push(row);
            }
        }
        return out;
    },

    // Returns the membership row, or null. The authorisation check for a
    // requested acting org.
    async find(userId, orgId) {
        if (!userId || !orgId) return null;
        const { data, error } = await serviceClient
            .from('user_organisations')
            .select('organisation_id, role, permissions')
            .eq('user_id', userId)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) return null;
        return data ?? null;
    },

    async add(userId, orgId, role, permissions = {}) {
        const { error } = await serviceClient
            .from('user_organisations')
            .upsert(
                { user_id: userId, organisation_id: orgId, role, permissions },
                { onConflict: 'user_id,organisation_id' },
            );
        if (error) throw error;
    },

    async remove(userId, orgId) {
        const { error } = await serviceClient
            .from('user_organisations')
            .delete()
            .eq('user_id', userId)
            .eq('organisation_id', orgId);
        if (error) throw error;
    },

    // Batch form of add(). One statement instead of N, so a multi-account
    // assignment has one failure point rather than one per account. Same
    // conflict target as add(), so it stays an upsert.
    async addMany(rows) {
        if (!rows?.length) return;
        const { error } = await serviceClient
            .from('user_organisations')
            .upsert(rows, { onConflict: 'user_id,organisation_id' });
        if (error) throw error;
    },

    // Batch form of remove(), scoped to ONE user and an explicit org list —
    // never a bare delete on user_id, which would take memberships this
    // caller cannot see.
    async removeMany(userId, orgIds) {
        if (!userId || !orgIds?.length) return;
        const { error } = await serviceClient
            .from('user_organisations')
            .delete()
            .eq('user_id', userId)
            .in('organisation_id', orgIds);
        if (error) throw error;
    },
};
