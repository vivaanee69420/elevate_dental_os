// ============================================================================
// Period-keyed AI context snapshot cache. serviceClient + explicit org filter
// (project convention — repos enforce tenant isolation manually). Queries in,
// rows out; no business logic.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const aiContextSnapshotRepository = {
  async get(orgId, periodKey) {
    const { data } = await supabase_1.serviceClient
      .from('ai_context_snapshots').select('*')
      .eq('organisation_id', orgId).eq('period_key', periodKey).maybeSingle();
    return data || null;
  },
  async upsert(orgId, periodKey, snapshot, isFinal) {
    const { error } = await supabase_1.serviceClient
      .from('ai_context_snapshots')
      .upsert({
        organisation_id: orgId, period_key: periodKey,
        snapshot, is_final: !!isFinal, computed_at: new Date().toISOString(),
      }, { onConflict: 'organisation_id,period_key' });
    if (error) throw error;
  },
  // Force the next read to recompute the listed periods (and un-finalize any a
  // backfill touched) by zeroing computed_at.
  async markDirty(orgId, periodKeys) {
    if (!periodKeys?.length) return;
    const { error } = await supabase_1.serviceClient
      .from('ai_context_snapshots')
      .update({ is_final: false, computed_at: new Date(0).toISOString() })
      .eq('organisation_id', orgId).in('period_key', periodKeys);
    if (error) throw error;
  },
  async finalize(orgId, periodKey) {
    const { error } = await supabase_1.serviceClient
      .from('ai_context_snapshots')
      .update({ is_final: true })
      .eq('organisation_id', orgId).eq('period_key', periodKey);
    if (error) throw error;
  },
};
