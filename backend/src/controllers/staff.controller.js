// ============================================================================
// Staff controller — parse query, call service, shape the HTTP response.
// ============================================================================
import { staffService } from "../services/staff.service.js";
import { staffListQuerySchema } from "../models/staff.model.js";

export const staffController = {
    async list(req, res) {
        const q = staffListQuerySchema.parse(req.query);
        res.json(await staffService.list(req.user.organisation_id, q));
    },
};
