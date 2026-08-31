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

    async setParent(orgId, parentOrgId) {
        const { error } = await serviceClient
            .from('organisations')
            .update({ parent_organisation_id: parentOrgId })
            .eq('id', orgId);
        if (error) throw error;
    },
};
