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
            .select('integration_account_id, ghl_pipeline_id, pipeline_name, channel, source, detected_leads, detected_share')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // accountId|pipelineId -> channel. Absence of a key means nobody has
    // decided; a key mapped to NULL means the owner decided "no channel".
    async channelMap(orgId) {
        const rows = await this.list(orgId);
        const m = new Map();
        for (const r of rows) m.set(key(r.integration_account_id, r.ghl_pipeline_id), r.channel);
        return m;
    },

    // accountId|pipelineId -> the whole decision, provenance included, so the
    // mapping screen can distinguish a channel somebody CHOSE from one that was
    // detected — and show the evidence behind the guess instead of asserting it.
    async decisionMap(orgId) {
        const rows = await this.list(orgId);
        const m = new Map();
        for (const r of rows) {
            m.set(key(r.integration_account_id, r.ghl_pipeline_id), {
                channel: r.channel ?? null,
                source: r.source ?? 'owner',
                detectedLeads: r.detected_leads ?? null,
                detectedShare: r.detected_share === null || r.detected_share === undefined
                    ? null : Number(r.detected_share),
            });
        }
        return m;
    },

    // Which ad channels this org has mapped AT ALL — not how many pipelines,
    // just whether the channel has any.
    //
    // Since migrations 000171/000178/000179, the pipeline map is what DEFINES
    // each report's lead pool: "if a lead has come from a google ads pipeline
    // that lead belongs to google ads, whether it has a gclid or not, and the
    // same goes for meta". An org that has never mapped a pipeline therefore
    // has a structurally empty pool, and its Marketing pages rendered real
    // spend beside 0 leads and an em-dash cost per lead with nothing said —
    // a confident zero, which is the one thing an empty state must never be.
    // Found on a live sub-account with GBP 5,478 of September Meta spend, 86
    // of whose September leads carried a Meta ad id.
    async mappedChannels(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .select('channel')
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
        return new Set((data ?? []).map((r) => r.channel).filter(Boolean));
    },

    // Clearing a channel writes a row with channel NULL — it does NOT delete.
    //
    // Deleting was right while a human was the only writer: absence meant
    // unassigned and nothing could disagree. With detection filling gaps
    // (migration 000180), absence means "nobody has decided", so a deleted row
    // would be re-detected and reassigned on the next run — the owner's
    // decision undone by morning, silently. The explicit null row is that
    // decision, recorded.
    async setChannel(orgId, accountId, pipelineId, pipelineName, channel) {
        const { error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .upsert({
                organisation_id: orgId,
                integration_account_id: accountId,
                ghl_pipeline_id: String(pipelineId),
                pipeline_name: pipelineName ?? null,
                channel: channel ?? null,
                // A human touched it, so detection must never touch it again —
                // including when they cleared it.
                source: 'owner',
                detected_leads: null,
                detected_share: null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,integration_account_id,ghl_pipeline_id' });
        if (error) throw new Error(error.message);
    },

    // Per-pipeline attribution evidence, aggregated in SQL. Never a table read:
    // the population is leads x contacts and PostgREST truncates at 1000 in
    // silence, which would let detection decide on a page rather than the org.
    async attributionCounts(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('ad_pipeline_attribution_counts', { p_org: orgId });
        if (error) throw new Error(`ad_pipeline_attribution_counts: ${error.message}`);
        return data ?? [];
    },

    // Write detected mappings. INSERT-only by construction: detectMappings has
    // already dropped every pipeline that carries a row, so there is nothing to
    // conflict with — and using an upsert here would quietly acquire the power
    // to overwrite an owner's choice the first time that filter had a bug.
    async insertDetected(orgId, rows) {
        if (!rows?.length) return 0;
        const { error } = await supabase_1.serviceClient
            .from('ad_channel_pipelines')
            .insert(rows.map((r) => ({ ...r, organisation_id: orgId })));
        if (error) throw new Error(`insertDetected: ${error.message}`);
        return rows.length;
    },
};
