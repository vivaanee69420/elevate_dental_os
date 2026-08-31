// Marketing controller — parse/validate, call the service, shape the response.
// No business logic.
import { z } from 'zod';
import { marketingService } from '../services/marketing.service.js';

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

export async function getPerformance(req, res, next) {
    try {
        const q = PerformanceQuerySchema.parse(req.query);
        const practiceId = q.scope && UUID_RE.test(q.scope) ? q.scope : null;
        const data = await marketingService.campaignPerformance(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId,
        });
        res.json(data);
    } catch (err) { next(err); }
}
