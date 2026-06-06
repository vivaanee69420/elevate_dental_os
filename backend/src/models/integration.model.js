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
// { mappings: { [stageId]: status } } — the service further checks each value.
export const stageMappingsSchema = zod_1.z.object({
    mappings: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
});
// Real-time webhook shared secret (Dentally HMAC). Empty string clears it.
export const webhookSecretSchema = zod_1.z.object({
    secret: zod_1.z.string().max(500),
});
// On-demand pull: ?full=true (query) or { full: true } (body) re-pulls window.
export const syncBodySchema = zod_1.z.object({
    full: zod_1.z.boolean().optional(),
});
