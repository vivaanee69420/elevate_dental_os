// ============================================================================
// Treatment controller — parse query, call service, shape the HTTP response.
// ============================================================================
import { treatmentService } from "../services/treatment.service.js";
import { treatmentMixQuerySchema } from "../models/treatment.model.js";

export const treatmentController = {
    async mix(req, res) {
        const q = treatmentMixQuerySchema.parse(req.query);
        res.json(await treatmentService.mix(req.user.organisation_id, q));
    },
};
