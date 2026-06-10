// ============================================================================
// Review model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";

export const reviewRespondSchema = zod_1.z.object({
    response: zod_1.z.string().min(1),
});

// Provider values match reviews.source / review_sources.provider.
export const reviewProviderSchema = zod_1.z.enum(['google', 'facebook']);

// GET /api/reviews filter query.
export const reviewListQuerySchema = zod_1.z.object({
    source: reviewProviderSchema.optional(),
    practice_id: zod_1.z.string().uuid().optional(),
});

// Picker search.
export const reviewSearchSchema = zod_1.z.object({
    provider: reviewProviderSchema,
    q: zod_1.z.string().optional().default(''),
});

// Add a source (a Google place / Facebook page) to the org.
export const reviewSourceCreateSchema = zod_1.z.object({
    provider: reviewProviderSchema,
    external_id: zod_1.z.string().min(1),
    name: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    practice_id: zod_1.z.string().uuid().optional().nullable(),
});

export const reviewSourceSelectionSchema = zod_1.z.object({
    selected_ids: zod_1.z.array(zod_1.z.string().uuid()),
});

export const reviewSourcePracticeSchema = zod_1.z.object({
    practice_id: zod_1.z.string().uuid().nullable(),
});
