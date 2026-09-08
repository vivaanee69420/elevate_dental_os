// ============================================================================
// Chair utilisation model — Zod schemas for the manual chair-utilisation domain.
// ============================================================================
import * as zod_1 from "zod";

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

export const chairUtilisationListQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().optional(),
    // As-of period end for historical grid reads (000055).
    asOf: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Booked can never exceed available — occupancy is booked/available and must
// stay <= 100%. Rejected at the API boundary so the grid can't store >100% cells.
const bookedNotOverAvailable = (v) =>
    v.booked_minutes == null || v.available_minutes == null ||
    v.booked_minutes <= v.available_minutes;
const bookedOverAvailableIssue = {
    message: 'Booked time cannot exceed available time',
    path: ['booked_minutes'],
};

export const chairUtilisationCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    chair_name: zod_1.z.string().trim().min(1).max(120),
    weekday: zod_1.z.coerce.number().int().min(1).max(7),
    slot: zod_1.z.enum(['morning', 'midday', 'afternoon', 'evening']),
    booked_minutes: zod_1.z.coerce.number().int().min(0),
    available_minutes: zod_1.z.coerce.number().int().min(0),
    // Typical-week revenue for this chair+weekday+slot, integer pence. Drives the
    // owner-entered yield/hr on Chair Efficiency.
    revenue_pence: zod_1.z.coerce.number().int().min(0).optional().default(0),
    notes: zod_1.z.string().trim().max(500).optional(),
}).refine(bookedNotOverAvailable, bookedOverAvailableIssue);

export const chairUtilisationUpdateSchema = chairUtilisationCreateSchema
    .innerType()
    .omit({ practice_id: true })
    .partial()
    .refine(bookedNotOverAvailable, bookedOverAvailableIssue);

// ── Rebuild (000180): chairs, opening hours, and whole-week saves ───────────

const SLOT_ENUM = zod_1.z.enum(['morning', 'midday', 'afternoon', 'evening']);

export const chairPracticeQuerySchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
});

// One chair's whole week. Capped at 28 (7 weekdays x 4 slots): a larger body
// is not a bigger week, it is a mistake or an attack.
//
// available_minutes is absent by design — capacity is derived from the
// practice's opening hours, and accepting a typed value would recreate the
// second, drifting definition this rebuild removes.
export const chairWeekSaveSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    chair_id: zod_1.z.string().uuid(),
    cells: zod_1.z.array(zod_1.z.object({
        weekday: zod_1.z.coerce.number().int().min(1).max(7),
        slot: SLOT_ENUM,
        booked_minutes: zod_1.z.coerce.number().int().min(0).max(1440),
        revenue_pence: zod_1.z.coerce.number().int().min(0).default(0),
        // The clinician in this chair in this slot. Nullable on purpose: a slot
        // may be recorded without naming who worked it, and null CLEARS a
        // previously-set clinician rather than leaving a stale one behind.
        associate_id: zod_1.z.string().uuid().nullable().optional(),
        notes: zod_1.z.string().trim().max(500).optional(),
    })).min(1).max(28),
}).strict();

export const practiceChairCreateSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    name: zod_1.z.string().trim().min(1).max(120),
    display_order: zod_1.z.coerce.number().int().min(0).max(999).optional(),
}).strict();

// .strict(), never z.record(z.any()): a freeform patch makes organisation_id
// writable, which is a cross-org write dressed as an update.
export const practiceChairUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    display_order: zod_1.z.coerce.number().int().min(0).max(999).optional(),
    active: zod_1.z.boolean().optional(),
}).strict();

// Minutes from LOCAL midnight. Both null means closed that day, which is a
// legitimate state and the reason these are nullable rather than optional.
export const openingHoursSaveSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid(),
    days: zod_1.z.array(zod_1.z.object({
        weekday: zod_1.z.coerce.number().int().min(1).max(7),
        openMinute: zod_1.z.coerce.number().int().min(0).max(1440).nullable(),
        closeMinute: zod_1.z.coerce.number().int().min(0).max(1440).nullable(),
    }).refine(
        (d) => (d.openMinute == null && d.closeMinute == null)
            || (d.openMinute != null && d.closeMinute != null && d.closeMinute > d.openMinute),
        { message: 'Closing time must be after opening time, or both left blank for a closed day' },
    )).min(1).max(7),
}).strict();
