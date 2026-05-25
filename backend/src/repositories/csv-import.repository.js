// CSV import repository — queries in, rows out. Staging lives in
// csv_import_batches + csv_import_rows; approved rows upsert into the live
// table for the dataset (payments/contacts/appointments) with source='manual'.
//
// Uses serviceClient and enforces tenant isolation by explicit organisation_id
// filters on every query (same path as the other repos).

import * as supabase_1 from "../lib/supabase.js";

export const csvImportRepository = {
    async createBatch(orgId, userId, dataset, filename, counts) {
        const { data, error } = await supabase_1.serviceClient
            .from('csv_import_batches')
            .insert({
                organisation_id: orgId,
                dataset,
                filename: filename ?? null,
                status: 'pending',
                uploaded_by: userId,
                row_count: counts.row_count,
                valid_count: counts.valid_count,
                rejected_count: counts.rejected_count,
            })
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data;
    },

    async insertRows(rows) {
        if (rows.length === 0) return;
        const { error } = await supabase_1.serviceClient.from('csv_import_rows').insert(rows);
        if (error) throw new Error(error.message);
    },

    async listBatches(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('csv_import_batches')
            .select('*')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    async getBatch(orgId, batchId) {
        const { data, error } = await supabase_1.serviceClient
            .from('csv_import_batches')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('id', batchId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
    },

    async getRows(orgId, batchId) {
        const { data, error } = await supabase_1.serviceClient
            .from('csv_import_rows')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('batch_id', batchId)
            .order('row_number', { ascending: true });
        if (error) throw new Error(error.message);
        return data ?? [];
    },

    // Upsert the mapped live rows idempotently and mark the batch approved.
    async approveBatch(orgId, batchId, approverId, table, onConflict, liveRows) {
        if (liveRows.length > 0) {
            const { error } = await supabase_1.serviceClient.from(table).upsert(liveRows, { onConflict });
            if (error) throw new Error(`${table} upsert: ${error.message}`);
        }
        const { error: e2 } = await supabase_1.serviceClient
            .from('csv_import_batches')
            .update({ status: 'approved', approved_by: approverId, approved_at: new Date().toISOString() })
            .eq('organisation_id', orgId)
            .eq('id', batchId);
        if (e2) throw new Error(e2.message);
    },

    async rejectBatch(orgId, batchId, reason) {
        const { error } = await supabase_1.serviceClient
            .from('csv_import_batches')
            .update({ status: 'rejected', reject_reason: reason ?? null })
            .eq('organisation_id', orgId)
            .eq('id', batchId);
        if (error) throw new Error(error.message);
    },

    // { practice_code -> practices.id } for the org.
    async loadSiteMap(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('practices')
            .select('id, pms_site_id')
            .eq('organisation_id', orgId)
            .not('pms_site_id', 'is', null);
        const map = new Map();
        for (const p of data ?? []) map.set(String(p.pms_site_id), p.id);
        return map;
    },

    // { external patient id -> contacts.id } (manual + dentally, so payments link either source's patient).
    async loadContactMap(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('contacts')
            .select('id, pms_external_id')
            .eq('organisation_id', orgId)
            .not('pms_external_id', 'is', null);
        const map = new Map();
        for (const c of data ?? []) map.set(String(c.pms_external_id), c.id);
        return map;
    },
};
