import * as cockpit_service_1 from "../services/cockpit.service.js";
import * as cockpit_model_1 from "../models/cockpit.model.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export const cockpitController = {
    async cockpit(req, res) {
        const q = cockpit_model_1.cockpitQuerySchema.parse(req.query);
        const practiceId = (q.scope && q.scope !== 'all' && UUID_RE.test(q.scope)) ? q.scope : undefined;
        res.json(await cockpit_service_1.cockpitService.build(req.user.organisation_id, { since: q.since, until: q.until, practiceId }));
    },

    // Lazy detail endpoints — fetched only when the caller opens a drill-down.
    async leads(req, res) {
        const q = cockpit_model_1.cockpitLeadsDetailQuerySchema.parse(req.query);
        res.json(await cockpit_service_1.cockpitService.leadsDetail(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practiceId, channel: q.channel, limit: q.limit, offset: q.offset,
        }));
    },

    async treatments(req, res) {
        const q = cockpit_model_1.cockpitDetailQuerySchema.parse(req.query);
        res.json(await cockpit_service_1.cockpitService.treatmentsDetail(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practiceId, limit: q.limit, offset: q.offset,
        }));
    },

    async cashupDays(req, res) {
        const q = cockpit_model_1.cockpitDetailQuerySchema.parse(req.query);
        res.json(await cockpit_service_1.cockpitService.cashupDaysDetail(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practiceId, limit: q.limit, offset: q.offset,
        }));
    },
};
