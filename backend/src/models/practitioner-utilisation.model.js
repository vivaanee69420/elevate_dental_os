// ============================================================================
// Practitioner utilisation — request shape.
// ============================================================================
import * as zod_1 from "zod";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const practitionerUtilisationQuerySchema = zod_1.z.object({
    // Plain calendar dates, not instants. These are London days, and an
    // instant would shift the window across the BST boundary.
    since: zod_1.z.string().regex(YMD, 'since must be YYYY-MM-DD'),
    until: zod_1.z.string().regex(YMD, 'until must be YYYY-MM-DD'),
    practice_id: zod_1.z.string().uuid().optional(),
    // Which derived denominator to divide by. Defaults to the clinical window:
    // the diary span counts leading and trailing blocks as available time and
    // reads ~20 points lower for it.
    basis: zod_1.z.enum(['span', 'clinical']).optional().default('clinical'),
}).refine((q) => q.since <= q.until, {
    // An inverted range matches nothing and would render an empty screen to a
    // practice with a full diary — reported elsewhere in this product as
    // "never synced" for exactly this reason.
    message: 'since must not be after until',
    path: ['since'],
});
