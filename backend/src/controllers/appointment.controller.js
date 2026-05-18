"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentController = void 0;
const appointment_service_1 = require("../services/appointment.service");
const appointment_model_1 = require("../models/appointment.model");
exports.appointmentController = {
    async list(req, res) {
        const q = appointment_model_1.appointmentListQuerySchema.parse(req.query);
        const appointments = await appointment_service_1.appointmentService.list(req.user.organisation_id, q);
        res.json({ appointments });
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
