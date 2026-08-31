// ============================================================================
// Appointment service — business logic for the appointments domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as appointment_repository_1 from "../repositories/appointment.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
export const appointmentService = {
    list(orgId, q) {
        return appointment_repository_1.appointmentRepository.list(orgId, q);
    },
    async create(orgId, input) {
        // These three are embedded back on read (contact/associate/practice),
        // so an unvalidated foreign id becomes a cross-org PII disclosure.
        await assertOrgOwns(orgId, 'contacts', input.contact_id, 'Contact');
        await assertOrgOwns(orgId, 'practices', input.practice_id, 'Practice');
        await assertOrgOwns(orgId, 'associates', input.associate_id, 'Associate');
        const { data, error } = await appointment_repository_1.appointmentRepository.create({
            ...input,
            organisation_id: orgId,
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
