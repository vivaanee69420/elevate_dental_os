// ============================================================================
// Appointment model — Zod schemas + inferred types for the appointments domain.
// ============================================================================
import * as zod_1 from "zod";
import { stripImmutable } from "../lib/tenant-guard.js";
export const appointmentListQuerySchema = zod_1.z.object({
    from: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    associate_id: zod_1.z.string().uuid().optional(),
    // Patient appointments only (default). Dentally also syncs patient-less diary
    // blocks (lunch / not-working / nurse-cover / empty slots) which carry no
    // pms_patient_id; excluding them keeps the list to real, named appointments —
    // same convention as the occurred-appointment rollup (migration 000076). Pass
    // patients_only=false to include diary blocks.
    patients_only: zod_1.z.enum(['true', 'false']).optional().default('true'),
    // Patient search — matches name, email or phone. THREE characters is the
    // floor, and it is a performance boundary, not a preference: a trigram is
    // three characters, so a shorter term cannot use the GIN index at all and
    // falls back to scanning every contact in the org (measured 258ms, against
    // 27ms for the worst indexed term). It matches most of the book anyway. An
    // empty string is treated as "no search" rather than rejected, so a cleared
    // search box does not 400.
    search: zod_1.z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), zod_1.z.string().trim().min(3).max(80).optional()),
    // Pagination. Query params arrive as strings, so coerce; default 25/page.
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    per_page: zod_1.z.coerce.number().int().min(1).max(100).optional().default(25),
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
// Freeform patch, but row identity/tenancy is stripped at the parse boundary:
// the UPDATE's WHERE is org-scoped, so without this a caller could set
// organisation_id and push its own row into another tenant.
export const appointmentUpdateSchema = zod_1.z.record(zod_1.z.any()).transform(stripImmutable);
