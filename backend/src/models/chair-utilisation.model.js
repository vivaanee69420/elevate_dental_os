// ============================================================================
// Chair utilisation model — Zod schemas for the manual chair-utilisation domain.
// ============================================================================
import * as zod_1 from "zod";

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

export const chairUtilisationListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
});

export const chairUtilisationCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    chair_name: zod_1.z.string().trim().min(1).max(120),
    weekday: zod_1.z.coerce.number().int().min(1).max(7),
    slot: zod_1.z.enum(['morning', 'midday', 'afternoon', 'evening']),
    booked_minutes: zod_1.z.coerce.number().int().min(0),
    available_minutes: zod_1.z.coerce.number().int().min(0),
    notes: zod_1.z.string().trim().max(500).optional(),
});

export const chairUtilisationUpdateSchema = chairUtilisationCreateSchema
    .omit({ practice_id: true })
    .partial();
