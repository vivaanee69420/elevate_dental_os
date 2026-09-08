import { practitionerUtilisationService } from "../services/practitioner-utilisation.service.js";
import { practitionerUtilisationQuerySchema } from "../models/practitioner-utilisation.model.js";

export const practitionerUtilisationController = {
    // The organisation always comes from the authenticated session. A practice
    // in the query only narrows WITHIN it.
    async overview(req, res) {
        const q = practitionerUtilisationQuerySchema.parse(req.query);
        res.json(await practitionerUtilisationService.overview(req.user.organisation_id, {
            since: q.since,
            until: q.until,
            practiceId: q.practice_id ?? null,
        }));
    },
};
