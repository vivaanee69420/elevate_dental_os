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
};
