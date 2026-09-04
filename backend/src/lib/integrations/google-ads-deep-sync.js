// ============================================================================
// Google Ads deep-grain sync — ad group, ad, and keyword. Separate from
// google-ads-sync.js, which owns campaign grain and is already long enough;
// this file adds three GAQL streams per account.
//
// HIERARCHY: Campaign -> Ad Group -> { Ads, Keywords }. Ads and keywords are
// SIBLINGS under an ad group, not parent and child. So an ad's (or a
// keyword's) parent_id is its ad group id, never its campaign id.
//
// Google removed average position in September 2019. The impression-share
// metrics (search, top, absolute top) plus Quality Score and its three
// components are the ranking signals that replaced it — pulled on the
// keyword stream only, since Quality Score is a keyword-level concept.
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

// Google's impression-share metrics replaced average position, which was
// removed in September 2019. They are ratios in 0..1; Google caps the reported
// value for very high shares, so treat them as indicative rather than exact.
function ratio(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function buildKeywordGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_criterion.criterion_id, ad_group_criterion.status,',
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,',
        'ad_group_criterion.quality_info.quality_score,',
        'ad_group_criterion.quality_info.creative_quality_score,',
        'ad_group_criterion.quality_info.post_click_quality_score,',
        'ad_group_criterion.quality_info.search_predicted_ctr,',
        'segments.date,', METRICS + ',',
        'metrics.search_impression_share, metrics.search_top_impression_share,',
        'metrics.search_absolute_top_impression_share',
        `FROM keyword_view WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

export function parseKeywords(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const crit = r.adGroupCriterion ?? {};
        const id = crit.criterionId;
        const adGroupId = r.adGroup?.id;
        if (!id || !adGroupId || !r.campaign?.id || !r.segments?.date) continue;
        const { campaign_id, campaign_name, metric_date, spend_pence, impressions, clicks, conversions: cv,
                organisation_id, practice_id, provider, customer_id } = core(r, ctx);
        const q = crit.qualityInfo ?? {};
        const m = r.metrics ?? {};
        out.push({
            organisation_id, practice_id, provider, customer_id,
            campaign_id, campaign_name,
            parent_id: String(adGroupId),      // a keyword hangs off its AD GROUP
            entity_id: String(id),
            entity_name: crit.keyword?.text ?? null,
            entity_status: crit.status ?? null,
            metric_date, spend_pence, impressions, clicks, conversions: cv,
            match_type: crit.keyword?.matchType ?? null,
            quality_score: intOrNull(q.qualityScore),
            creative_quality_score: q.creativeQualityScore ?? null,
            post_click_quality_score: q.postClickQualityScore ?? null,
            search_predicted_ctr: q.searchPredictedCtr ?? null,
            search_impression_share: ratio(m.searchImpressionShare),
            search_top_impression_share: ratio(m.searchTopImpressionShare),
            search_absolute_top_impression_share: ratio(m.searchAbsoluteTopImpressionShare),
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
    { grain: 'google_keyword', gaql: buildKeywordGaql, parse: parseKeywords },
];

export async function syncGoogleDeep(orgId, { accessToken, customerIds, since, until, queryCustomer }) {
    const collected = new Map(STREAMS.map((s) => [s.grain, []]));
    const skipped = [];
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
                // frequently transient and retried tomorrow.
                //
                // NOT deduped per customer: the grain identifies which part of
                // the pull failed, and keyword pulls (the biggest row count)
                // trip the 403 throttle far more often than ad group/ad ones.
                // "Keywords failed for account X" tells the owner their
                // keyword page is stale while ad groups are fine; collapsing
                // to one entry per account would throw that away.
                skipped.push({ customerId, grain: stream.grain, error: String(err.message).slice(0, 200) });
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
        //
        // ONE CALL PER ACCOUNT, not one per grain. Every account's rows used to
        // go up in a single jsonb argument, so the payload grew with the number
        // of connected accounts while the RPC's statement_timeout stayed at 60s.
        // That worked at one account and failed at three: a 92-day keyword pull
        // for three accounts timed out, and because the deep sync is wrapped so
        // it can never fail the campaign sync, the only symptom was deep tabs
        // quietly serving stale rows. Per-account is equivalent — the RPC's
        // DELETE is already scoped to `customer_id = ANY(cids)` — and it bounds
        // each transaction by ONE account's size instead of the whole org's, so
        // connecting another practice cannot push the write over the limit.
        let n = 0;
        for (const cid of cids) {
            const forCustomer = rows.filter((r) => String(r.customer_id) === String(cid));
            if (!forCustomer.length) continue;
            n += await adGrainRepository.replaceWindow(orgId, stream.grain, [cid], forCustomer);
        }
        counts[stream.grain] = n;
    }
    return { counts, skipped };
}

export const __test = {
    microsToPence, conversions, buildAdGroupGaql, buildAdGaql, buildKeywordGaql,
    parseAdGroups, parseAds, parseKeywords, DEEP_WINDOW_DAYS,
    STREAM_GRAINS: STREAMS.map((s) => s.grain),
};
