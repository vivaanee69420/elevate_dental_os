// ============================================================================
// Open days — the events, and which ad campaigns promoted them.
//
// Queries in, rows out. Every statement carries an explicit
// organisation_id filter: repositories here run on the service client, which
// bypasses RLS, so that filter IS the tenant boundary. It matters more than
// usual on this table because open days are the one mapping a TENANT owner can
// edit rather than only an agency admin — the id in the request comes from the
// caller, so the org filter is what stops an id from another tenant matching.
// The composite foreign key (organisation_id, open_day_id) backs it up in the
// database, but a query that forgot the filter would still read rows it should
// not see.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const openDayRepository = {
    // Every event the org has, newest first. Undated events sort last rather
    // than first — the column is nullable on purpose and NULLS LAST keeps a
    // missing date from looking like the oldest event.
    async list(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_open_days')
            .select('id, name, event_date, created_at')
            .eq('organisation_id', orgId)
            .order('event_date', { ascending: false, nullsFirst: false })
            .order('name', { ascending: true });
        if (error) throw new Error(`ad_open_days: ${error.message}`);
        return (data ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            eventDate: r.event_date ?? null,
        }));
    },

    // campaign -> event, for one provider. Small by nature (one row per mapped
    // campaign; 37 of 84 for the largest org today), so it is read whole and
    // joined in memory rather than per campaign.
    async mappings(orgId, provider) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_open_day_campaigns')
            .select('open_day_id, campaign_id, customer_id')
            .eq('organisation_id', orgId)
            .eq('provider', provider);
        if (error) throw new Error(`ad_open_day_campaigns: ${error.message}`);
        return (data ?? []).map((r) => ({
            openDayId: r.open_day_id,
            campaignId: String(r.campaign_id),
            customerId: r.customer_id ?? null,
        }));
    },

    async create(orgId, { name, eventDate = null }) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_open_days')
            // organisation_id is stamped from the authenticated caller, never
            // read off the request body.
            .insert({ organisation_id: orgId, name, event_date: eventDate })
            .select('id, name, event_date')
            .single();
        if (error) throw new Error(`ad_open_days insert: ${error.message}`);
        return { id: data?.id, name: data?.name, eventDate: data?.event_date ?? null };
    },

    async update(orgId, id, { name, eventDate }) {
        // Only the two editable columns are ever built into the patch, so
        // organisation_id cannot be smuggled in through a freeform body — the
        // cross-org write documented in docs/ISOLATION_AUDIT.md.
        const patch = {};
        if (name !== undefined) patch.name = name;
        if (eventDate !== undefined) patch.event_date = eventDate;
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase_1.serviceClient
            .from('ad_open_days')
            .update(patch)
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(`ad_open_days update: ${error.message}`);
    },

    // The mapped campaigns go with it (ON DELETE CASCADE on the composite FK),
    // so deleting an event returns its campaigns to always-on rather than
    // stranding rows that point at nothing.
    async remove(orgId, id) {
        const { error } = await supabase_1.serviceClient
            .from('ad_open_days')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', id);
        if (error) throw new Error(`ad_open_days delete: ${error.message}`);
    },

    // Replace one event's campaign set.
    //
    // Delete-then-insert scoped to THIS event, never a whole-provider wipe: two
    // events' mappings live in the same table, and clearing by (org, provider)
    // would silently unmap every other event on the way past.
    //
    // The insert is an upsert on the primary key, which is how a campaign moves
    // between events: (organisation_id, provider, campaign_id) already exists
    // pointing at its old event, and the conflict update re-points it. A plain
    // insert would fail instead, and the owner would have to unmap first.
    async setCampaigns(orgId, openDayId, provider, campaigns) {
        const { error: delError } = await supabase_1.serviceClient
            .from('ad_open_day_campaigns')
            .delete()
            .eq('organisation_id', orgId)
            .eq('open_day_id', openDayId);
        if (delError) throw new Error(`ad_open_day_campaigns delete: ${delError.message}`);

        const rows = (campaigns ?? [])
            .filter((c) => c && c.campaign_id != null)
            .map((c) => ({
                organisation_id: orgId,
                open_day_id: openDayId,
                provider,
                campaign_id: String(c.campaign_id),
                customer_id: c.customer_id ?? null,
            }));
        // An empty set is a real instruction — "this event has no campaigns" —
        // and the delete above has already carried it out. Sending an empty
        // array to PostgREST is a request that does nothing but can error.
        if (rows.length === 0) return { mapped: 0 };

        const { error } = await supabase_1.serviceClient
            .from('ad_open_day_campaigns')
            .upsert(rows, { onConflict: 'organisation_id,provider,campaign_id' });
        if (error) throw new Error(`ad_open_day_campaigns upsert: ${error.message}`);
        return { mapped: rows.length };
    },

    // pipeline -> event, for every subaccount. Small (one row per mapped
    // pipeline), so it is read whole and joined in memory.
    async pipelineMappings(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_open_day_pipelines')
            .select('open_day_id, integration_account_id, ghl_pipeline_id')
            .eq('organisation_id', orgId);
        if (error) throw new Error(`ad_open_day_pipelines: ${error.message}`);
        return (data ?? []).map((r) => ({
            openDayId: r.open_day_id,
            integrationAccountId: r.integration_account_id,
            ghlPipelineId: String(r.ghl_pipeline_id),
        }));
    },

    // Set or clear ONE pipeline's event.
    //
    // Clearing DELETES rather than writing a null open_day_id: the column is
    // NOT NULL and part of the foreign key, and "no row" is already the
    // representation of always-on. A nullable event id would give the same
    // state two spellings.
    async setPipeline(orgId, { integrationAccountId, ghlPipelineId, openDayId }) {
        if (openDayId == null) {
            const { error } = await supabase_1.serviceClient
                .from('ad_open_day_pipelines')
                .delete()
                .eq('organisation_id', orgId)
                .eq('integration_account_id', integrationAccountId)
                .eq('ghl_pipeline_id', String(ghlPipelineId));
            if (error) throw new Error(`ad_open_day_pipelines delete: ${error.message}`);
            return;
        }
        const { error } = await supabase_1.serviceClient
            .from('ad_open_day_pipelines')
            .upsert({
                organisation_id: orgId,
                open_day_id: openDayId,
                integration_account_id: integrationAccountId,
                ghl_pipeline_id: String(ghlPipelineId),
            }, { onConflict: 'organisation_id,integration_account_id,ghl_pipeline_id' });
        if (error) throw new Error(`ad_open_day_pipelines upsert: ${error.message}`);
    },
};
