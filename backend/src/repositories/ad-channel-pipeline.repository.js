// ============================================================================
// Ad channel pipeline repository — the explicit GHL pipeline -> ad channel map.
// Tenant isolation: serviceClient path, so EVERY query carries an explicit
// .eq('organisation_id', orgId) (rule 3).
//
// A pipeline with no row here is UNASSIGNED. Clearing a channel deletes the
// row; there is no 'unassigned' value to write.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// Pipeline ids are only unique within a GHL Location, so the map key must
// include the subaccount.
const key = (accountId, pipelineId) => `${accountId}|${pipelineId}`;

export const adChannelPipelineRepository = {
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .select('integration_account_id, ghl_pipeline_id, pipeline_name, channel')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // accountId|pipelineId -> channel. Absence of a key means unassigned.
    async channelMap(orgId) {
        const rows = await this.list(orgId);
        const m = new Map();
        for (const r of rows) m.set(key(r.integration_account_id, r.ghl_pipeline_id), r.channel);
        return m;
    },

    // channel null clears the mapping (deletes the row).
    async setChannel(orgId, accountId, pipelineId, pipelineName, channel) {
        if (channel === null || channel === undefined) {
            const { error } = await supabase_1.serviceClient
                .from('ad_channel_pipelines')
                .delete()
                .eq('organisation_id', orgId)
                .eq('integration_account_id', accountId)
                .eq('ghl_pipeline_id', String(pipelineId));
            if (error) throw new Error(error.message);
            return;
        }
        const { error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .upsert({
                organisation_id: orgId,
                integration_account_id: accountId,
                ghl_pipeline_id: String(pipelineId),
                pipeline_name: pipelineName ?? null,
                channel,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,integration_account_id,ghl_pipeline_id' });
        if (error) throw new Error(error.message);
    },
};
