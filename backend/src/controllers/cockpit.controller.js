import * as cockpit_service_1 from "../services/cockpit.service.js";
import * as cockpit_model_1 from "../models/cockpit.model.js";

export const cockpitController = {
    async cockpit(req, res) {
        const q = cockpit_model_1.cockpitQuerySchema.parse(req.query);
        res.json(await cockpit_service_1.cockpitService.build(req.user.organisation_id, { since: q.since, until: q.until }));
    },
};
