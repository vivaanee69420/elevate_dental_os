// ============================================================================
// Review-source repository — Supabase data access for review_sources (the
// Google place_id / Facebook page id locations the reviews sync pulls from).
// Mirrors the ad_accounts dimension: discover/add → select → filter on read.
// Every query carries organisation_id (tenant isolation on the serviceClient).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const reviewSourceRepository = {
    // All sources for an org (optionally one provider), with the linked practice
    // name for the selector + per-practice breakdown labels.
    async list(orgId, provider = null) {
        let q = supabase_1.serviceClient
            .from('review_sources')
            .select('id, provider, external_id, name, address, practice_id, is_selected, rating, total_count, last_sync_at, last_error, practice:practices(name)')
            .eq('organisation_id', orgId)
            .order('provider', { ascending: true })
            .order('name', { ascending: true });
        if (provider) q = q.eq('provider', provider);
        const { data } = await q;
        return (data ?? []).map((r) => ({
            ...r,
            practice_name: r.practice?.name ?? null,
            practice: undefined,
        }));
    },

    // The selected sources the sync should pull (and the read filter spans).
    async listSelected(orgId, provider = null) {
        let q = supabase_1.serviceClient
            .from('review_sources')
            .select('id, provider, external_id, name, practice_id, is_selected')
            .eq('organisation_id', orgId)
            .eq('is_selected', true);
        if (provider) q = q.eq('provider', provider);
        const { data } = await q;
        return data ?? [];
    },

    // Add (or re-add) a source. Unique on (org, provider, external_id); a repeat
    // add updates name/address/practice without duplicating.
    async add(orgId, { provider, external_id, name, address, practice_id }) {
        const row = {
            organisation_id: orgId,
            provider,
            external_id: String(external_id),
            name: name ?? null,
            address: address ?? null,
            practice_id: practice_id ?? null,
            is_selected: true,
        };
        const { data, error } = await supabase_1.serviceClient
            .from('review_sources')
            .upsert(row, { onConflict: 'organisation_id,provider,external_id', ignoreDuplicates: false })
            .select('id, provider, external_id, name, address, practice_id, is_selected, rating, total_count, last_sync_at')
            .single();
        if (error) throw new Error(`review_sources add: ${error.message}`);
        return data;
    },

    async remove(orgId, id) {
        const { error } = await supabase_1.serviceClient
            .from('review_sources')
            .delete()
            .eq('id', id)
            .eq('organisation_id', orgId);
        if (error) throw new Error(error.message);
    },

    // Link/unlink a source to a practice (drives the by-practice breakdown).
    async setPractice(orgId, id, practiceId) {
        const { data, error } = await supabase_1.serviceClient
            .from('review_sources')
            .update({ practice_id: practiceId ?? null })
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select('id, practice_id')
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    // Persist the selection: mark the given ids selected, the rest not. Two
    // UPDATEs (not N) like setAdAccountSelection.
    async setSelection(orgId, selectedIds) {
        const selected = new Set((selectedIds ?? []).map(String));
        const all = await this.list(orgId);
        const toSelect = all.filter((s) => selected.has(s.id)).map((s) => s.id);
        const toDeselect = all.filter((s) => !selected.has(s.id)).map((s) => s.id);
        if (toSelect.length) {
            const { error } = await supabase_1.serviceClient
                .from('review_sources').update({ is_selected: true })
                .eq('organisation_id', orgId).in('id', toSelect);
            if (error) throw new Error(`review_sources select: ${error.message}`);
        }
        if (toDeselect.length) {
            const { error } = await supabase_1.serviceClient
                .from('review_sources').update({ is_selected: false })
                .eq('organisation_id', orgId).in('id', toDeselect);
            if (error) throw new Error(`review_sources deselect: ${error.message}`);
        }
        return this.list(orgId);
    },

    // Stamp the provider-reported aggregates + sync outcome after a pull.
    async updateSyncResult(orgId, id, { rating, total_count, last_error = null }) {
        await supabase_1.serviceClient
            .from('review_sources')
            .update({
                rating: rating ?? null,
                total_count: total_count ?? null,
                last_error,
                last_sync_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('organisation_id', orgId);
    },
};
