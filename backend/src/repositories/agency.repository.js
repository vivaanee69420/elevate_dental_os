// ============================================================================
// Agency hierarchy data access. Children are scoped by parent_organisation_id
// = the AGENCY org id; feature/parent writes take one explicit child org id —
// the SERVICE validates child-of-agency before calling in.
// ============================================================================
import { serviceClient } from "../lib/supabase.js";

export const agencyRepository = {
    async childOrgs(agencyOrgId) {
        const { data, error } = await serviceClient
            .from('organisations')
            .select('id, name, created_at')
            .eq('parent_organisation_id', agencyOrgId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data ?? [];
    },

    // Connected-integration summary for the sub-account list. One IN query.
    async orgIntegrations(orgIds) {
        if (!orgIds.length) return [];
        const { data, error } = await serviceClient
            .from('integrations')
            .select('organisation_id, provider, status')
            .in('organisation_id', orgIds);
        if (error) throw error;
        return data ?? [];
    },

    async featureRows(orgId) {
        const { data, error } = await serviceClient
            .from('org_features')
            .select('feature, enabled')
            .eq('organisation_id', orgId);
        if (error) throw error;
        return data ?? [];
    },

    async upsertFeature(orgId, feature, enabled) {
        const { error } = await serviceClient
            .from('org_features')
            .upsert(
                { organisation_id: orgId, feature, enabled, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,feature' },
            );
        if (error) throw error;
    },

    // Create a sub-account organisation directly under the agency. Unlike
    // provisionOrgOwner this makes NO user — the agency adds them afterwards.
    async createOrg(name, slug, parentOrgId) {
        return serviceClient
            .from('organisations')
            .insert({ name, slug, parent_organisation_id: parentOrgId, is_agency: false })
            .select('id, name, created_at')
            .single();
    },

    async listOrgUsers(orgId) {
        const { data, error } = await serviceClient
            .from('users')
            .select('id, email, full_name, role, status, created_at')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data ?? [];
    },

    // Read BEFORE deleting the org: the cascade removes public.users, but the
    // Supabase auth identities have to be deleted explicitly or they orphan.
    async orgUserIds(orgId) {
        const { data, error } = await serviceClient
            .from('users')
            .select('id')
            .eq('organisation_id', orgId);
        if (error) throw error;
        return (data ?? []).map((r) => r.id);
    },

    // Irreversible: every business table FKs organisation_id ON DELETE CASCADE.
    async deleteOrg(orgId) {
        const { error } = await serviceClient.from('organisations').delete().eq('id', orgId);
        if (error) throw error;
    },

    async setParent(orgId, parentOrgId) {
        const { error } = await serviceClient
            .from('organisations')
            .update({ parent_organisation_id: parentOrgId })
            .eq('id', orgId);
        if (error) throw error;
    },
};
