"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentService = void 0;
// ============================================================================
// Appointment service — business logic for the appointments domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
const appointment_repository_1 = require("../repositories/appointment.repository");
const errors_1 = require("../middleware/errors");
exports.appointmentService = {
    list(orgId, q) {
        return appointment_repository_1.appointmentRepository.list(orgId, q);
    },
    async create(orgId, input) {
        const { data, error } = await appointment_repository_1.appointmentRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await appointment_repository_1.appointmentRepository.update(orgId, id, patch);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};
