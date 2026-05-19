// ============================================================================
// Integration model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const integrationConnectSchema = zod_1.z.object({
    provider: zod_1.z.string(),
    redirect_url: zod_1.z.string().url().optional(),
});
