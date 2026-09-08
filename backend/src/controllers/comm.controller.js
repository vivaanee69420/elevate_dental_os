import * as comm_service_1 from "../services/comm.service.js";
import * as comm_model_1 from "../models/comm.model.js";
export const commController = {
    async list(req, res) {
        const q = comm_model_1.commListQuerySchema.parse(req.query);
        const viewer = { id: req.user.id, role: req.user.role };
        const communications = await comm_service_1.commService.list(req.user.organisation_id, q, viewer);
        res.json({ communications });
    },
    // Inbox thread list — paged and searched in SQL. The organisation and the
    // viewer both come from the authenticated session; neither is ever read
    // off the request.
    async inbox(req, res) {
        const q = comm_model_1.commInboxQuerySchema.parse(req.query);
        const viewer = { id: req.user.id, role: req.user.role };
        res.json(await comm_service_1.commService.inbox(req.user.organisation_id, viewer, q));
    },
    async thread(req, res) {
        const { thread_key } = comm_model_1.commThreadQuerySchema.parse(req.query);
        const viewer = { id: req.user.id, role: req.user.role };
        res.json(await comm_service_1.commService.thread(req.user.organisation_id, viewer, thread_key));
    },
    async send(req, res) {
        const body = comm_model_1.commSendSchema.parse(req.body);
        res.json(await comm_service_1.commService.send(req.user.organisation_id, body, req.log));
    },
};
