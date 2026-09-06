// Marketing controller — parse/validate, call the service, shape the response.
// No business logic.
import { z } from 'zod';
import { marketingService } from '../services/marketing.service.js';
import { adReconciliationService } from '../services/ad-reconciliation.service.js';
import { facebookReportService } from '../services/facebook-report.service.js';
import { googleReportService } from '../services/google-report.service.js';
import { londonDaysAgo, londonYmd } from '../lib/tz.js';
import { DEEP_WINDOW_DAYS } from '../lib/integrations/google-ads-deep-sync.js';

// The shared ScopePeriod bar sends ISO datetimes (not plain dates) and a
// `scope` that is either the literal 'all' or a practice UUID. Guard the UUID
// rather than trusting the string — the same pattern Contacts/Leads/Pipeline use.
const PerformanceQuerySchema = z.object({
    since: z.string().datetime({ offset: true }),
    until: z.string().datetime({ offset: true }),
    scope: z.string().optional(),
    label: z.string().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHANNELS = ['google_ads', 'meta_ads', 'other'];

export const LeadListQuerySchema = PerformanceQuerySchema.extend({
    channel: z.enum(CHANNELS).optional(),
    // Sent as a string on the query string; 'any' means no filter.
    converted: z.enum(['true', 'false', 'any']).optional(),
    // The ad platform's OWN campaign id (e.g. '120249721894530517'), not a
    // uuid. Bounded in length so the filter cannot be used to send a payload.
    campaignId: z.string().min(1).max(128).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    size: z.coerce.number().int().min(1).max(200).optional(),
});

const practiceOf = (scope) => (scope && UUID_RE.test(scope) ? scope : null);

// Deliberately PLAIN dates, not the ScopePeriod bar's ISO datetime: this
// window feeds ad_grain_rollup and the new campaignSpendByProvider read
// directly, both of which compare plain DATE columns inclusive on both ends
// (`>= since AND <= until`) — not the half-open, London-resolved instant the
// other marketing endpoints take. Mixing the two conventions on this one
// endpoint is exactly how a false gap would reach the reconciliation screen.
//
// BOTH ARE OPTIONAL, and omitting them is the intended use. The deep pull's
// window is londonDaysAgo(DEEP_WINDOW_DAYS)..londonYmd() — London days. A
// caller computing the same window from its own UTC clock disagrees with that
// for the hour after midnight London through the whole of BST, and asks for a
// day that exists in ad_metrics but cannot exist in the deep tables yet: a
// full day of campaign spend lands on one side of the comparison only and
// every non-keyword level goes red. When the parameters are absent the server
// computes the window with the SAME helpers and the SAME constant the sync
// uses, so there is one clock and one window definition.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ReconciliationQuerySchema = z.object({
    since: z.string().regex(YMD_RE, 'since must be YYYY-MM-DD').optional(),
    until: z.string().regex(YMD_RE, 'until must be YYYY-MM-DD').optional(),
    provider: z.enum(['google_ads', 'meta_ads']).default('google_ads'),
});

export async function getPerformance(req, res, next) {
    try {
        const q = PerformanceQuerySchema.parse(req.query);
        const data = await marketingService.campaignPerformance(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: practiceOf(q.scope),
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getTrend(req, res, next) {
    try {
        const q = PerformanceQuerySchema.parse(req.query);
        const data = await marketingService.trend(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: practiceOf(q.scope),
        });
        res.json(data);
    } catch (err) { next(err); }
}

// The tally between our deep-grain totals and the platform's own campaign
// total — the owner's stated acceptance criterion made into a product
// surface. orgId always comes from the authenticated session, never the
// query string (rule 3 — serviceClient has no automatic isolation).
export async function getReconciliation(req, res, next) {
    try {
        const q = ReconciliationQuerySchema.parse(req.query);
        const data = await adReconciliationService.build(req.user.organisation_id, {
            // Same helpers, same constant, as the deep pull itself — see the
            // schema comment. A caller's own clock is never used for this.
            since: q.since ?? londonDaysAgo(DEEP_WINDOW_DAYS),
            until: q.until ?? londonYmd(),
            provider: q.provider,
        });
        res.json(data);
    } catch (err) { next(err); }
}

// since/until are OPTIONAL: when absent the server defaults them from the
// same helpers the sync uses (see the ReconciliationQuerySchema comment
// above), so both sides of every comparison use one clock. There is
// deliberately no organisation field — the org comes from
// req.user.organisation_id, which under an agency switch is already the
// sub-account's id. Accepting it from the request would be a cross-tenant
// hole (M1); a test asserts a submitted organisation_id is stripped.
//
// campaignId/adSetId are the ad platform's OWN ids (e.g.
// '120249721894530517'), not uuids — same bounded free-text shape as
// LeadListQuerySchema's campaignId above, so the filter cannot carry a
// payload. Both are OPTIONAL: a standalone ad-sets/ads tab omits them
// entirely and lists every ad set, or every ad, in the window — that is the
// whole point of moving the parent id off the path and into the query.
export const FacebookQuerySchema = z.object({
    since: z.string().regex(YMD_RE, 'since must be YYYY-MM-DD').optional(),
    until: z.string().regex(YMD_RE, 'until must be YYYY-MM-DD').optional(),
    campaignId: z.string().min(1).max(128).optional(),
    adSetId: z.string().min(1).max(128).optional(),
    cursor: z.string().regex(/^\d{1,9}$/).optional(),
}).strip().refine(
    // Only applies when BOTH are present — either one alone is filled in
    // server-side by windowFrom() and is never inverted against itself. An
    // inverted range (since > until) would otherwise reach
    // campaignSpendByProvider's .gte(since).lte(until), match nothing, and
    // get reported as state: 'never_synced' — telling a fully synced tenant
    // they have never connected Meta. A plain string compare is correct here
    // because YYYY-MM-DD sorts lexicographically (same reasoning as
    // clampWindow in facebook-report.service.js) — equal since/until (a
    // single-day selection) is a legitimate request and must be accepted.
    (q) => !q.since || !q.until || q.since <= q.until,
    { message: 'since must not be after until', path: ['since'] },
);

function windowFrom(q) {
    return {
        since: q.since ?? londonDaysAgo(DEEP_WINDOW_DAYS),
        until: q.until ?? londonYmd(),
    };
}

export async function getFacebookCampaigns(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.campaigns(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getFacebookAdSets(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.adSets(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id), campaignId: q.campaignId ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getFacebookAds(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.ads(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id), adSetId: q.adSetId ?? null, cursor: q.cursor ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

// Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords } — ads and
// keywords are SIBLINGS under an ad group, not parent and child, which is why
// there are four routes here where Facebook has three. `campaignId` and
// `parentId` are both OPTIONAL query filters, same shape/reasoning as
// FacebookQuerySchema's campaignId/adSetId above: `parentId` is an ad
// GROUP's own id (never a campaign id) when it narrows /ads or /keywords.
// Omitting either lists everything in scope; supplying it narrows to one
// parent. Same deliberately-shared schema across all four routes as
// FacebookQuerySchema — a given route only ever reads the keys it needs.
export const GoogleQuerySchema = z.object({
    since: z.string().regex(YMD_RE, 'since must be YYYY-MM-DD').optional(),
    until: z.string().regex(YMD_RE, 'until must be YYYY-MM-DD').optional(),
    campaignId: z.string().min(1).max(128).optional(),
    parentId: z.string().min(1).max(128).optional(),
    cursor: z.string().regex(/^\d{1,9}$/).optional(),
}).strip().refine(
    // Same reasoning as FacebookQuerySchema's refine: an inverted range would
    // otherwise reach campaignSpendByProvider's .gte(since).lte(until) /
    // ad_grain_rollup's date bounds, match nothing, and get reported as
    // state: 'never_synced' to a fully synced tenant.
    (q) => !q.since || !q.until || q.since <= q.until,
    { message: 'since must not be after until', path: ['since'] },
);

export async function getGoogleCampaigns(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        const data = await googleReportService.campaigns(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getGoogleAdGroups(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        const data = await googleReportService.adGroups(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id), campaignId: q.campaignId ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getGoogleAds(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        const data = await googleReportService.ads(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
            campaignId: q.campaignId ?? null, parentId: q.parentId ?? null, cursor: q.cursor ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getGoogleKeywords(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        const data = await googleReportService.keywords(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
            campaignId: q.campaignId ?? null, parentId: q.parentId ?? null, cursor: q.cursor ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

// FIFTH GRAIN, and the only one whose window is its own: search terms are kept
// for 30 days, not the 92 every other deep grain holds (see the service's
// clampSearchTermWindow and the connector's SEARCH_TERM_WINDOW_DAYS). The
// clamp is applied and REPORTED in the payload, never silently.
export async function getGoogleSearchTerms(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        const data = await googleReportService.searchTerms(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
            campaignId: q.campaignId ?? null, parentId: q.parentId ?? null, cursor: q.cursor ?? null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

// Blended CPL/CPB/CPA for Meta, on the SAME acceptance rule as the Google
// endpoint below (migration 000167). Same query shape as the Facebook grain
// routes; campaignId/adSetId/cursor are accepted and unused — this endpoint
// returns every grain it has in one payload.
export async function getFacebookLeadPerformance(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        // No include_existing param, for the same reason as Google's: the
        // "new patients only" vs "including existing" toggle is answered
        // client-side from ONE fetch that carries both, so flipping it costs
        // nothing and the two figures can never be computed differently.
        const data = await facebookReportService.leadPerformance(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
        });
        res.json(data);
    } catch (err) { next(err); }
}

// Same query shape as the four grain routes — since/until optional
// YYYY-MM-DD, practice_id optional. campaignId/parentId/cursor are accepted
// (GoogleQuerySchema.strip()) but unused here: this endpoint has no
// per-campaign grain at all, see google-report.service.js's leadPerformance.
export async function getGoogleLeadPerformance(req, res, next) {
    try {
        const q = GoogleQuerySchema.parse(req.query);
        // No include_existing query param: the owner-requested "new
        // patients only" vs "including existing patients" toggle is answered
        // entirely client-side now — leadPerformance returns BOTH
        // (practices/total AND practicesAll/totalAll) from one fetch, so
        // flipping the toggle costs nothing over the network. See
        // leadPerformance's own comment for why that mattered more than
        // anything in the query itself.
        const data = await googleReportService.leadPerformance(req.user.organisation_id, {
            ...windowFrom(q), practiceId: practiceOf(req.query.practice_id),
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getLeads(req, res, next) {
    try {
        const q = LeadListQuerySchema.parse(req.query);
        const data = await marketingService.leadList(req.user.organisation_id, {
            since: q.since,
            until: q.until,
            practiceId: practiceOf(q.scope),
            channel: q.channel ?? null,
            converted: q.converted === 'true' ? true : q.converted === 'false' ? false : null,
            campaignId: q.campaignId ?? null,
            page: q.page ?? 1,
            size: q.size ?? 50,
        });
        res.json(data);
    } catch (err) { next(err); }
}
