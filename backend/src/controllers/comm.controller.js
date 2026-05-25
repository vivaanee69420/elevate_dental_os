import * as comm_service_1 from "../services/comm.service.js";
import * as comm_model_1 from "../models/comm.model.js";
export const commController = {
    async list(req, res) {
        const q = comm_model_1.commListQuerySchema.parse(req.query);
        const viewer = { id: req.user.id, role: req.user.role };
        const communications = await comm_service_1.commService.list(req.user.organisation_id, q, viewer);
        res.json({ communications });
    },
    async send(req, res) {
        const body = comm_model_1.commSendSchema.parse(req.body);
        res.json(await comm_service_1.commService.send(req.user.organisation_id, body, req.log));
    },
};
