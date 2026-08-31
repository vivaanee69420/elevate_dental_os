// ============================================================================
// Durable (Postgres) tier of the dashboard payload cache.
//
// Tier 1 is the in-process TTL cache — fastest, but per-instance and lost on
// every deploy, so the first load after each push pays the full 16-aggregate
// cost again. This tier survives restarts and is shared across instances. A
// keyed read here is a single indexed primary-key lookup (~1ms) against
// recomputing seconds of aggregates.
//
// Every entry is pure derived data: safe to truncate, and best-effort by
// design — a cache failure logs and returns a miss rather than breaking the
// page. Reads and writes are org-scoped; a cache must never become a
// cross-tenant read path.
// ============================================================================
import { serviceClient } from './supabase.js';

export async function readDashboardCache(orgId, key) {
    if (!orgId || !key) return undefined;
    const { data, error } = await serviceClient
        .from('dashboard_cache')
        .select('payload, expires_at')
        .eq('organisation_id', orgId)
        .eq('cache_key', key)
        .maybeSingle();
    if (error || !data) return undefined;
    if (Date.parse(data.expires_at) <= Date.now()) return undefined; // expired = miss
    return data.payload ?? undefined;
}

export async function writeDashboardCache(orgId, key, payload, ttlMs) {
    if (!orgId || !key) return payload;
    const { error } = await serviceClient
        .from('dashboard_cache')
        .upsert(
            {
                organisation_id: orgId,
                cache_key: key,
                payload,
                expires_at: new Date(Date.now() + ttlMs).toISOString(),
            },
            { onConflict: 'organisation_id,cache_key' },
        );
    if (error) console.error('[dashboard-cache] write failed:', error.message);
    return payload;
}

// Drop one org's cached payloads — call after a sync writes new rows.
export async function purgeDashboardCache(orgId) {
    if (!orgId) return;
    const { error } = await serviceClient
        .from('dashboard_cache')
        .delete()
        .eq('organisation_id', orgId);
    if (error) console.error('[dashboard-cache] purge failed:', error.message);
}
