// ============================================================================
// Practitioner schedule — request shapes.
// ============================================================================
import * as zod_1 from "zod";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
// Minutes from local midnight. 1440 is the end of the day and a valid finish.
const MIN = zod_1.z.number().int().min(0).max(1440);

export const scheduleOverviewQuerySchema = zod_1.z.object({
    // The window the observed-diary hint is drawn from. Defaults to the last
    // 90 days, which is enough history to be worth showing without reaching
    // back to patterns that have since changed.
    observed_since: zod_1.z.string().regex(YMD).optional(),
    observed_until: zod_1.z.string().regex(YMD).optional(),
});

const daySchema = zod_1.z.object({
    weekday: zod_1.z.number().int().min(1).max(7),   // ISO Mon..Sun
    startMin: MIN,
    endMin: MIN,
    breakMin: zod_1.z.number().int().min(0).max(1440).default(0),
}).refine((d) => d.endMin > d.startMin, {
    message: 'A day must finish after it starts',
    path: ['endMin'],
}).refine((d) => d.breakMin < d.endMin - d.startMin, {
    // Deducting a break longer than the day would give negative available
    // time, which is not a small error — it inverts the utilisation.
    message: 'Breaks cannot be longer than the working day',
    path: ['breakMin'],
});

export const saveWeekSchema = zod_1.z.object({
    practitioner_id: zod_1.z.string().min(1).max(64),
    // The WHOLE week, every time. An empty array clears the schedule, which is
    // a real intention and must not be confused with "sent nothing".
    days: zod_1.z.array(daySchema).max(7),
}).refine((b) => new Set(b.days.map((d) => d.weekday)).size === b.days.length, {
    message: 'A weekday can only appear once',
    path: ['days'],
});

export const saveOverrideSchema = zod_1.z.object({
    practitioner_id: zod_1.z.string().min(1).max(64),
    day: zod_1.z.string().regex(YMD),
    // null clears the override and returns the day to the weekly pattern.
    override: zod_1.z.union([
        zod_1.z.null(),
        zod_1.z.object({
            notWorking: zod_1.z.boolean().default(false),
            startMin: MIN.optional(),
            endMin: MIN.optional(),
            breakMin: zod_1.z.number().int().min(0).max(1440).default(0),
            note: zod_1.z.string().max(200).optional(),
        }).refine(
            (o) => o.notWorking || (o.startMin != null && o.endMin != null && o.endMin > o.startMin),
            { message: 'A working override needs a start and a finish', path: ['startMin'] },
        ),
    ]),
});
