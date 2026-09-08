import { practitionerPerformanceService } from "../services/practitioner-performance.service.js";
import { practitionerUtilisationQuerySchema } from "../models/practitioner-utilisation.model.js";

export const practitionerPerformanceController = {
    // Same query shape as the utilisation screen, deliberately: the two pages
    // answer different questions about the SAME window and basis, so a reader
    // moving between them must not have to re-pick either. The organisation
    // always comes from the authenticated session; a practice in the query
    // only narrows WITHIN it.
    async overview(req, res) {
        const q = practitionerUtilisationQuerySchema.parse(req.query);
        res.json(await practitionerPerformanceService.overview(req.user.organisation_id, {
            since: q.since,
            until: q.until,
            practiceId: q.practice_id ?? null,
            basis: q.basis,
        }));
    },
};
