// ============================================================================
// Google Ads deep-grain sync — ad group and ad (keywords live in Task 7, same
// file). Separate from google-ads-sync.js, which owns campaign grain and is
// already long enough; this file adds three GAQL streams per account.
//
// HIERARCHY: Campaign -> Ad Group -> { Ads, Keywords }. Ads and keywords are
// SIBLINGS under an ad group, not parent and child. So an ad's parent_id is
// its ad group id, never its campaign id.
//
// cost_micros is account-currency micros: pence = micros / 10,000. Guarded by
// ad-currency.js — a non-GBP account never reaches here.
// ============================================================================
import { adGrainRepository } from "../../repositories/ad-grain.repository.js";

export const DEEP_WINDOW_DAYS = 92;

function microsToPence(micros) {
    const n = Number(micros ?? 0);
    return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
}

// Conversions stay FRACTIONAL. Google reports modelled conversions as decimals
// (3.5 is a real value in its own interface) and rounding here would leave our
// figure permanently a little off the platform's.
function conversions(v) {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
}

const METRICS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions';

export function buildAdGroupGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name,',
        'ad_group.id, ad_group.name, ad_group.status,',
        'segments.date,', METRICS,
        `FROM ad_group WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

export function buildAdGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,',
        'segments.date,', METRICS,
        `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

// searchStream returns an ARRAY of batches, each { results: [...] }, with
// camelCase JSON field names (costMicros, adGroupAd).
function* streamRows(batches) {
    for (const batch of Array.isArray(batches) ? batches : []) {
        for (const r of batch?.results ?? []) yield r;
    }
}

function core(r, { orgId, customerId }) {
    return {
        organisation_id: orgId,
        practice_id: null,          // stamped in the replace RPC from ad_accounts
        provider: 'google_ads',
        customer_id: customerId,
        campaign_id: String(r.campaign?.id ?? ''),
        campaign_name: r.campaign?.name ?? null,
        metric_date: r.segments?.date,
        spend_pence: microsToPence(r.metrics?.costMicros),
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions: conversions(r.metrics?.conversions),
    };
}

export function parseAdGroups(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const id = r.adGroup?.id;
        const campaignId = r.campaign?.id;
        if (!id || !campaignId || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(campaignId),        // an ad group hangs off its campaign
            entity_id: String(id),
            entity_name: r.adGroup?.name ?? null,
            entity_status: r.adGroup?.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
        });
    }
    return out;
}

export function parseAds(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const id = r.adGroupAd?.ad?.id;
        const adGroupId = r.adGroup?.id;
        if (!id || !adGroupId || !r.campaign?.id || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(adGroupId),         // an ad hangs off its AD GROUP
            entity_id: String(id),
            entity_name: r.adGroupAd?.ad?.name ?? null,
            entity_status: r.adGroupAd?.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
        });
    }
    return out;
}

// One pull per grain per account. `queryCustomer` is injected so the caller
// owns the HTTP concern (headers, API-version self-healing, 403 backoff) and
// tests need no network.
const STREAMS = [
    { grain: 'google_adgroup', gaql: buildAdGroupGaql, parse: parseAdGroups },
    { grain: 'google_ad',      gaql: buildAdGaql,      parse: parseAds },
];

export async function syncGoogleDeep(orgId, { accessToken, customerIds, since, until, queryCustomer }) {
    const collected = new Map(STREAMS.map((s) => [s.grain, []]));
    const skipped = [];
    const skippedCustomers = new Set();
    const withRows = new Map(STREAMS.map((s) => [s.grain, new Set()]));

    for (const customerId of customerIds ?? []) {
        for (const stream of STREAMS) {
            try {
                const batches = await queryCustomer(customerId, accessToken, stream.gaql(since, until));
                const rows = stream.parse(batches, { orgId, customerId });
                if (rows.length) {
                    collected.get(stream.grain).push(...rows);
                    withRows.get(stream.grain).add(customerId);
                }
            } catch (err) {
                // One account (or one grain of it) failing must not sink the
                // rest — each stream is tried independently, so a bad
                // ad_group_ad query doesn't stop ad_group from being pulled.
                // Google reports rate limiting as HTTP 403, so this is
                // frequently transient and retried tomorrow. Report the
                // account once, not once per failing grain.
                if (!skippedCustomers.has(customerId)) {
                    skippedCustomers.add(customerId);
                    skipped.push({ customerId, error: String(err.message).slice(0, 200) });
                }
            }
        }
    }

    const counts = {};
    for (const stream of STREAMS) {
        const rows = collected.get(stream.grain);
        const cids = [...withRows.get(stream.grain)];
        // Replace ONLY for accounts that actually returned rows. An empty 200 —
        // report not ready, throttle, momentary access loss — must not trigger
        // a destructive delete of good history.
        counts[stream.grain] = rows.length
            ? await adGrainRepository.replaceWindow(orgId, stream.grain, cids, rows)
            : 0;
    }
    return { counts, skipped };
}

export const __test = { microsToPence, conversions, buildAdGroupGaql, buildAdGaql, parseAdGroups, parseAds, DEEP_WINDOW_DAYS };
