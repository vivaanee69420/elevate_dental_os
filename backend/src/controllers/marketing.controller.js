// Marketing controller — parse/validate, call the service, shape the response.
// No business logic.
import { z } from 'zod';
import { marketingService } from '../services/marketing.service.js';
import { adReconciliationService } from '../services/ad-reconciliation.service.js';

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
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const ReconciliationQuerySchema = z.object({
    since: z.string().regex(YMD_RE, 'since must be YYYY-MM-DD'),
    until: z.string().regex(YMD_RE, 'until must be YYYY-MM-DD'),
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
            since: q.since, until: q.until, provider: q.provider,
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
