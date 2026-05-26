import * as appointment_service_1 from "../services/appointment.service.js";
import * as appointment_model_1 from "../models/appointment.model.js";
export const appointmentController = {
    async list(req, res) {
        const q = appointment_model_1.appointmentListQuerySchema.parse(req.query);
        const { rows, total } = await appointment_service_1.appointmentService.list(req.user.organisation_id, q);
        res.json({ appointments: rows, total, page: q.page, per_page: q.per_page });
    },
    async create(req, res) {
        const body = appointment_model_1.appointmentCreateSchema.parse(req.body);
        res.json(await appointment_service_1.appointmentService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = appointment_model_1.appointmentUpdateSchema.parse(req.body);
        res.json(await appointment_service_1.appointmentService.update(req.user.organisation_id, req.params.id, body));
    },
};
