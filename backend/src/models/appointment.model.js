// ============================================================================
// Appointment model — Zod schemas + inferred types for the appointments domain.
// ============================================================================
import * as zod_1 from "zod";
export const appointmentListQuerySchema = zod_1.z.object({
    from: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    associate_id: zod_1.z.string().uuid().optional(),
});
export const appointmentCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    contact_id: zod_1.z.string().uuid().optional(),
    associate_id: zod_1.z.string().uuid().optional(),
    starts_at: zod_1.z.string(),
    ends_at: zod_1.z.string(),
    appointment_type: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    deposit_pence: zod_1.z.number().int().optional(),
});
export const appointmentUpdateSchema = zod_1.z.record(zod_1.z.any());
