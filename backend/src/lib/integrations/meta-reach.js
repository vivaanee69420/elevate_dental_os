// Live per-window reach/frequency for Meta ad accounts, cached in
// ad_reach_cache (migration 000073) with a TTL.
//
// Reach is deduplicated unique people over a window and is NOT additive across
// days, so it cannot be rebuilt from the daily ad_metrics rows. Meta only
// reports the true figure when an account is queried for the EXACT window
// (level=account, no time_increment). The marketing read paths need this for
// whatever window the user is viewing (this month, a custom range, ...), so we
// query Meta on demand and cache each (account, window) result. A cache hit
// within TTL_MS is served without touching the Graph API; a miss/stale entry
// re-queries Meta and upserts.
//
// Returns Map keyed `meta_ads::<customer_id>` -> snapshot shape consumed by
// lib/marketing-reach.js overlayPeriodReach(): { period_reach, period_frequency,
// period_window_start, period_window_end }. window_start/end are set to the
// requested window, so the overlay treats the figure as exact (not approx).
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";
import { integrationRepository } from "../../repositories/integration.repository.js";
import { fetchAccountPeriodInsight } from "./meta-ads-sync.js";

const TTL_MS = 6 * 3600_000; // 6 hours

// A cached row is fresh when its fetched_at is within the TTL of `nowMs`.
export function isFresh(fetchedAt, nowMs, ttlMs = TTL_MS) {
    if (!fetchedAt) return false;
    const t = new Date(fetchedAt).getTime();
    return Number.isFinite(t) && nowMs - t < ttlMs;
}

export async function fetchPeriodReach(orgId, customerIds, fromDate, toDate, { now = () => new Date() } = {}) {
    const out = new Map();
    const cids = (customerIds ?? []).filter(Boolean);
    if (cids.length === 0) return out;

    // Pull any cached rows for this org + provider + exact window.
    const { data: cached = [] } = await supabase_1.serviceClient
        .from('ad_reach_cache')
        .select('customer_id, reach, frequency, impressions, fetched_at')
        .eq('organisation_id', orgId)
        .eq('provider', 'meta_ads')
        .eq('window_start', fromDate)
        .eq('window_end', toDate)
        .in('customer_id', cids);

    const nowMs = now().getTime();
    const byCid = new Map((cached ?? []).map((c) => [c.customer_id, c]));
    const put = (cid, c) => out.set(`meta_ads::${cid}`, {
        period_reach: c.reach, period_frequency: c.frequency,
        period_window_start: fromDate, period_window_end: toDate,
    });

    const stale = [];
    for (const cid of cids) {
        const c = byCid.get(cid);
        if (c && isFresh(c.fetched_at, nowMs)) put(cid, c);
        else stale.push(cid);
    }
    if (stale.length === 0) return out;

    // Cache miss/stale -> query Meta for the exact window. Needs the stored
    // token; if it's absent or a query errors, that account simply yields no
    // entry (the caller falls back to '—' / the rolling snapshot).
    const integration = await integrationRepository.getByProvider(orgId, 'meta_ads');
    if (!integration?.secrets) return out;
    let accessToken;
    try {
        accessToken = JSON.parse(decryptSecret(integration.secrets)).access_token;
    } catch {
        return out;
    }
    if (!accessToken) return out;

    for (const cid of stale) {
        try {
            const p = await fetchAccountPeriodInsight(cid, accessToken, fromDate, toDate);
            if (!p) continue;
            const row = {
                organisation_id: orgId, provider: 'meta_ads', customer_id: cid,
                window_start: fromDate, window_end: toDate,
                reach: p.reach, frequency: p.frequency, impressions: p.impressions,
                spend_pence: p.spend_pence, fetched_at: new Date().toISOString(),
            };
            await supabase_1.serviceClient.from('ad_reach_cache')
                .upsert(row, { onConflict: 'organisation_id,provider,customer_id,window_start,window_end' });
            put(cid, row);
        } catch (err) {
            console.error(`[meta_ads] live reach query failed for ${cid} [${fromDate}..${toDate}]:`, err.message);
        }
    }
    return out;
}
