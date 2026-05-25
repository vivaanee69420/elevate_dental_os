// ============================================================================
// Integration model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const integrationConnectSchema = zod_1.z.object({
    provider: zod_1.z.string(),
    redirect_url: zod_1.z.string().url().optional(),
    apiKey: zod_1.z.string().optional(),
    baseUrl: zod_1.z.string().url().optional(),
});
export const integrationCallbackSchema = zod_1.z.object({
    code: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    apiKey: zod_1.z.string().optional(),
    baseUrl: zod_1.z.string().url().optional(),
});
