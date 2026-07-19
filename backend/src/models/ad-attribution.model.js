// ============================================================================
// Ad attribution model — Zod schemas. No ORM; Supabase is the store, so
// "model" = the validated shape of data entering/leaving this domain.
// ============================================================================
import * as zod_1 from "zod";

export const AD_CHANNELS = ['google_ads', 'meta_ads'];

// null clears the mapping — the pipeline returns to the Unassigned bucket.
export const setPipelineChannelSchema = zod_1.z.object({
    channel: zod_1.z.enum(AD_CHANNELS).nullable(),
});

export const setPracticeSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().nullable(),
});

export const performanceQuerySchema = zod_1.z.object({
    since: zod_1.z.string(),
    until: zod_1.z.string(),
    // The shared ScopePeriod bar sends scope='all' for the group.
    practice_id: zod_1.z.string().uuid().optional(),
});

export const adLeadsQuerySchema = zod_1.z.object({
    since: zod_1.z.string(),
    until: zod_1.z.string(),
    channel: zod_1.z.enum(['google_ads', 'meta_ads', 'unassigned']).optional(),
    practice_id: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.coerce.number().default(500),
});
