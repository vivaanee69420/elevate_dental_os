import { associateService } from "../services/associate.service.js";
import { associateListQuerySchema } from "../models/associate.model.js";

export const associateController = {
    async list(req, res) {
        const q = associateListQuerySchema.parse(req.query);
        const associates = await associateService.list(req.user.organisation_id, q);
        res.json({ associates });
    },
};
