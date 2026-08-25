// backend/src/models/data-room.model.js
// ============================================================================
// Data Room request schemas (Zod). Query values arrive as strings.
// ============================================================================
import * as zod_1 from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoish = zod_1.z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date/time');

export const dataRoomParamsSchema = zod_1.z.object({
    source: zod_1.z.string().regex(/^[a-z-]+$/),
    dataset: zod_1.z.string().regex(/^[a-z_]+$/),
});

export const dataRoomQuerySchema = zod_1.z.object({
    scope: zod_1.z.string().default('all')
        .refine((s) => s === 'all' || UUID_RE.test(s), 'scope must be "all" or a practice id'),
    since: isoish.optional(),
    until: isoish.optional(),
    cursor: zod_1.z.string().max(512).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(500).default(100),
    // Numbered pages: page=N switches the read to offset mode ((N-1)*limit).
    // Omitted -> keyset mode via `cursor` (the CSV export path).
    page: zod_1.z.coerce.number().int().min(1).optional(),
    pii: zod_1.z.enum(['0', '1']).default('0').transform((v) => v === '1'),
});
