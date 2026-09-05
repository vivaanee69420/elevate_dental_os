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
import { londonDaysAgo } from "../tz.js";

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

// Value, not just count. Without it a campaign producing ten GBP 40 enquiries and
// one producing ten GBP 4,000 implant consultations are indistinguishable in
// every view we have. all_conversions additionally carries the conversion
// actions excluded from the headline figure - phone calls from call
// extensions among them, which for a dental practice is most of the point.
const VALUE_METRICS = 'metrics.conversions_value, metrics.all_conversions';

// ============================================================================
// WHICH METRIC EACH RESOURCE ACCEPTS — MEASURED AGAINST THE LIVE API, NOT
// ASSUMED. Probed field by field on 2026-09-05 (customer 6846708190):
//
//                     conv_value  all_conv  phone_calls  impr_share  budget_lost  rank_lost
//   campaign              yes       yes        yes          yes          YES        yes
//   ad_group              yes       yes        yes          yes          no         yes
//   ad_group_ad           yes       yes        no           no           no         no
//   keyword_view          yes       yes        yes          yes          no         yes
//   search_term_view      yes       yes        no           no           no         no
//
// search_budget_lost_impression_share is CAMPAIGN-ONLY, and that is not an
// arbitrary API limit — a budget is a campaign-level object, so "share lost to
// budget" is a fact about the campaign that an ad group merely inherits.
//
// THIS TABLE EXISTS BECAUSE GUESSING IT COST A REAL PULL. GAQL rejects the
// WHOLE query on one unsupported field rather than omitting that column, so a
// single wrong name takes the entire grain down. The first version of this
// file asked every share of ad_group AND hedged by removing two from
// keyword_view — both wrong, in opposite directions. All three ad-group pulls
// fell back to the degraded shape and lost their conversion value with it,
// while keywords silently went without a rank-lost share the API was happy to
// give. Do not add a field to any list below without probing it first.
// ============================================================================

// Campaign grain only — see the table above. EXPORTED because the campaign
// pull lives in google-ads-sync.js, and a second copy of this list there is
// exactly the duplication that produced the degraded ad-group pull.
export const CAMPAIGN_SHARE_METRICS = [
    'metrics.search_impression_share',
    'metrics.search_top_impression_share',
    'metrics.search_absolute_top_impression_share',
    'metrics.search_budget_lost_impression_share',
    'metrics.search_rank_lost_impression_share',
].join(', ');

// Ad group AND keyword: everything except the budget-lost share. The
// rank-lost one IS supported at both, and it is the more actionable of the
// two at this depth anyway — it says raise the bid or improve the ad, which
// is a decision an ad group can act on, where a budget is not.
const SHARE_METRICS = [
    'metrics.search_impression_share',
    'metrics.search_top_impression_share',
    'metrics.search_absolute_top_impression_share',
    'metrics.search_rank_lost_impression_share',
].join(', ');

// Search terms are what people actually TYPED, as opposed to what we bid on.
// A shorter window than the other grains on purpose: this is a recent-activity
// report (you mine last month's terms for negatives, not last quarter's), and
// the row count is (term x ad group x day), an order of magnitude above any
// other grain. 30 days keeps the nightly write to a sane number of chunks
// while covering the period anyone actually acts on.
export const SEARCH_TERM_WINDOW_DAYS = 30;

export function buildAdGroupGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name,',
        'ad_group.id, ad_group.name, ad_group.status,',
        'segments.date,', METRICS + ',', VALUE_METRICS + ',', SHARE_METRICS,
        `FROM ad_group WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

// AN AD HAS NO NAME. ad_group_ad.ad.name is an optional internal label and
// almost no advertiser sets one: measured on this org's live tables, 0 of 186
// ads had one, so the Ads tab rendered a bare numeric id on every single row.
// The creative fields below are what a human actually calls an ad - the first
// responsive-search headline - and they are pulled for that reason first and
// as diagnostics (ad strength, approval status) second.
export function buildAdGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,',
        'ad_group_ad.ad.type, ad_group_ad.ad_strength,',
        'ad_group_ad.policy_summary.approval_status,',
        'ad_group_ad.ad.final_urls,',
        'ad_group_ad.ad.responsive_search_ad.headlines,',
        'ad_group_ad.ad.responsive_search_ad.descriptions,',
        'segments.date,', METRICS + ',', VALUE_METRICS,
        `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

// Google returns an RSA asset as an object carrying the text plus a
// pinned-field marker we do not use. Flattened to plain strings here so the
// stored jsonb is an array of text and every reader can treat it as one -
// a consumer that had to know about `.text` would be one more place to get
// the shape wrong.
export function assetTexts(assets) {
    if (!Array.isArray(assets)) return null;
    const out = assets
        .map((a) => (typeof a === 'string' ? a : a?.text))
        .filter((t) => typeof t === 'string' && t.length > 0);
    return out.length ? out : null;
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
        // Google reports conversions_value as a float in ACCOUNT currency
        // (guarded to GBP by ad-currency.js), so pence is x100. Kept null,
        // never 0, when Google reports nothing: a campaign we cannot price is
        // not a campaign worth nothing, and the two must stay tellable apart.
        conversions_value_pence: moneyToPence(r.metrics?.conversionsValue),
        all_conversions: r.metrics?.allConversions === undefined
            ? null : conversions(r.metrics?.allConversions),
    };
}

// Account-currency units -> integer pence (rule 2). Distinct from
// microsToPence: cost arrives in micros, conversion value arrives in whole
// currency units.
function moneyToPence(value) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// The five impression-share ratios, pulled off a metrics object. Absent
// wherever Google did not report one - a Display/Video day, a paused day, an
// entity not eligible to compete - and absent must stay null: ad_google_rollup
// filters its weighted-average denominator on exactly this nullness, and a 0
// here would drag every share downward.
function shareMetrics(m = {}) {
    return {
        search_impression_share: ratio(m.searchImpressionShare),
        search_top_impression_share: ratio(m.searchTopImpressionShare),
        search_absolute_top_impression_share: ratio(m.searchAbsoluteTopImpressionShare),
        search_budget_lost_impression_share: ratio(m.searchBudgetLostImpressionShare),
        search_rank_lost_impression_share: ratio(m.searchRankLostImpressionShare),
    };
}

export function parseAdGroups(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const id = r.adGroup?.id;
        const campaignId = r.campaign?.id;
        if (!id || !campaignId || !r.segments?.date) continue;
        out.push({
            ...core(r, ctx),
            ...shareMetrics(r.metrics),
            parent_id: String(campaignId),        // an ad group hangs off its campaign
            entity_id: String(id),
            entity_name: r.adGroup?.name ?? null,
            entity_status: r.adGroup?.status ?? null,
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
        const ad = r.adGroupAd?.ad ?? {};
        const headlines = assetTexts(ad.responsiveSearchAd?.headlines);
        const descriptions = assetTexts(ad.responsiveSearchAd?.descriptions);
        const finalUrl = Array.isArray(ad.finalUrls) ? (ad.finalUrls[0] ?? null) : null;
        out.push({
            ...core(r, ctx),
            parent_id: String(adGroupId),         // an ad hangs off its AD GROUP
            entity_id: String(id),
            // FALLING BACK TO THE FIRST HEADLINE IS THE POINT OF THIS PULL.
            // ad.name is null on essentially every real ad (0 of 186 here), so
            // without this the Ads tab is a list of 12-digit numbers. Order:
            // the advertiser's own label if they set one, else what the ad
            // actually says. Never the id - the reader can already see that.
            entity_name: ad.name ?? headlines?.[0] ?? null,
            entity_status: r.adGroupAd?.status ?? null,
            ad_type: ad.type ?? null,
            ad_strength: r.adGroupAd?.adStrength ?? null,
            approval_status: r.adGroupAd?.policySummary?.approvalStatus ?? null,
            final_url: finalUrl,
            headlines, descriptions,
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
        VALUE_METRICS + ',', SHARE_METRICS,
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
        const q = crit.qualityInfo ?? {};
        out.push({
            ...core(r, ctx),
            ...shareMetrics(r.metrics),
            parent_id: String(adGroupId),      // a keyword hangs off its AD GROUP
            entity_id: String(id),
            entity_name: crit.keyword?.text ?? null,
            entity_status: crit.status ?? null,
            match_type: crit.keyword?.matchType ?? null,
            quality_score: intOrNull(q.qualityScore),
            creative_quality_score: q.creativeQualityScore ?? null,
            post_click_quality_score: q.postClickQualityScore ?? null,
            search_predicted_ctr: q.searchPredictedCtr ?? null,
        });
    }
    return out;
}

// ============================================================================
// SEARCH TERMS - what people actually typed.
//
// The one report that says where money is leaking, and it cannot be derived
// from anything else we store: a dental group paying for "dental nurse jobs"
// or "dentist salary uk" finds out here and nowhere else. Keywords tell you
// what you BID on; search terms tell you what you BOUGHT.
//
// The matched keyword arrives as a SEGMENT (segments.keyword.info), not as a
// field of search_term_view - the term itself is not an entity in the account
// and has no id of its own, which is also why entity_id is the term TEXT (see
// migration 000164). segments.keyword is what ties a term back to the keyword
// that caught it, and that link is the actionable half: "this broad-match
// keyword is pulling in this rubbish".
// ============================================================================
export function buildSearchTermGaql(since, until) {
    return [
        'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,',
        'search_term_view.search_term, search_term_view.status,',
        'segments.keyword.info.text, segments.keyword.info.match_type,',
        'segments.date,', METRICS + ',', VALUE_METRICS,
        `FROM search_term_view WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' ');
}

export function parseSearchTerms(batches, ctx) {
    const out = [];
    for (const r of streamRows(batches)) {
        const term = r.searchTermView?.searchTerm;
        const adGroupId = r.adGroup?.id;
        if (!term || !adGroupId || !r.campaign?.id || !r.segments?.date) continue;
        out.push({
            ...core(r, ctx),
            parent_id: String(adGroupId),      // a search term is caught inside an AD GROUP
            // The TEXT is the identity. Google gives a search term no id
            // because it is not an object in the account - it is a string a
            // stranger typed - and (ad group, text, day) is exactly the unique
            // key the shared writer already conflicts on.
            entity_id: String(term),
            entity_name: String(term),
            // ADDED / EXCLUDED / NONE: whether anyone has already acted on
            // this term. Without it the same rubbish term is re-reported as
            // actionable every month after it has been excluded.
            entity_status: r.searchTermView?.status ?? null,
            search_term_status: r.searchTermView?.status ?? null,
            keyword_text: r.segments?.keyword?.info?.text ?? null,
            match_type: r.segments?.keyword?.info?.matchType ?? null,
        });
    }
    return out;
}

// ============================================================================
// FALLBACK QUERIES - the shape each stream had before the enrichment above.
//
// Every added field is a documented, long-standing Google Ads API field, but
// GAQL rejects an unknown or grain-incompatible field by failing the WHOLE
// query, not by omitting the column. Without a fallback, one field Google
// retires (it has retired fields before - average position went in September
// 2019) costs that grain its entire nightly pull, and because the deep sync is
// deliberately wrapped so it can never fail the campaign sync, the only symptom
// would be tabs quietly serving stale rows. That is the failure mode 000160's
// header records happening once already.
//
// So: try the enriched query, and on failure retry the shape that was working
// before. Degrading to fewer columns is recoverable; losing the grain is not.
// The retry is REPORTED in `skipped` with grain 'x:degraded' rather than
// swallowed - a silent downgrade that lasts for months is its own bug.
// ============================================================================
const BASIC_GAQL = {
    google_adgroup: (since, until) => [
        'SELECT campaign.id, campaign.name,',
        'ad_group.id, ad_group.name, ad_group.status,',
        'segments.date,', METRICS,
        `FROM ad_group WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' '),
    google_ad: (since, until) => [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,',
        'segments.date,', METRICS,
        `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' '),
    google_keyword: (since, until) => [
        'SELECT campaign.id, campaign.name, ad_group.id,',
        'ad_group_criterion.criterion_id, ad_group_criterion.status,',
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,',
        'ad_group_criterion.quality_info.quality_score,',
        'segments.date,', METRICS + ',',
        'metrics.search_impression_share, metrics.search_top_impression_share,',
        'metrics.search_absolute_top_impression_share',
        `FROM keyword_view WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    ].join(' '),
    // No fallback for search terms: the grain is new, so there is no earlier
    // working shape to fall back TO, and a stripped-down search-term pull
    // without the matched keyword would not be worth storing.
};

// One pull per grain per account. `queryCustomer` is injected so the caller
// owns the HTTP concern (headers, API-version self-healing, 403 backoff) and
// tests need no network.
//
// `days` overrides the caller's window for a single stream. Only search terms
// use it - see SEARCH_TERM_WINDOW_DAYS for why that grain is deliberately
// shallower than the rest.
const STREAMS = [
    { grain: 'google_adgroup',     gaql: buildAdGroupGaql,    parse: parseAdGroups },
    { grain: 'google_ad',          gaql: buildAdGaql,         parse: parseAds },
    { grain: 'google_keyword',     gaql: buildKeywordGaql,    parse: parseKeywords },
    { grain: 'google_search_term', gaql: buildSearchTermGaql, parse: parseSearchTerms,
      days: SEARCH_TERM_WINDOW_DAYS },
];

export async function syncGoogleDeep(orgId, { accessToken, customerIds, since, until, queryCustomer }) {
    const collected = new Map(STREAMS.map((s) => [s.grain, []]));
    const skipped = [];
    const withRows = new Map(STREAMS.map((s) => [s.grain, new Set()]));

    for (const customerId of customerIds ?? []) {
        for (const stream of STREAMS) {
            // A stream may ask for a shallower window than the caller's. Never
            // a DEEPER one: max() here means `days` can only ever pull the
            // window in, so a stream cannot quietly widen what the caller
            // (and the rolling-window contract) asked for.
            const streamSince = stream.days
                ? [since, londonDaysAgo(stream.days)].sort().at(-1)
                : since;
            try {
                let batches;
                try {
                    batches = await queryCustomer(customerId, accessToken, stream.gaql(streamSince, until));
                } catch (err) {
                    const basic = BASIC_GAQL[stream.grain];
                    if (!basic) throw err;
                    batches = await queryCustomer(customerId, accessToken, basic(streamSince, until));
                    skipped.push({
                        customerId, grain: `${stream.grain}:degraded`,
                        error: `enriched query failed, fell back to base fields: ${String(err.message).slice(0, 150)}`,
                    });
                }
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
    microsToPence, moneyToPence, conversions, assetTexts, shareMetrics,
    buildAdGroupGaql, buildAdGaql, buildKeywordGaql, buildSearchTermGaql,
    SHARE_METRICS, CAMPAIGN_SHARE_METRICS,
    parseAdGroups, parseAds, parseKeywords, parseSearchTerms,
    DEEP_WINDOW_DAYS, SEARCH_TERM_WINDOW_DAYS, BASIC_GAQL,
    STREAM_GRAINS: STREAMS.map((s) => s.grain),
};
