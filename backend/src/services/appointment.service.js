// ============================================================================
// Appointment service — business logic for the appointments domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as appointment_repository_1 from "../repositories/appointment.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const appointmentService = {
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
