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
// resources (optional) scopes a Dentally pull to specific collections — e.g.
// ['patients'] pulls ONLY patients, skipping the heavy payments/invoices phases.
// Omitted/empty = pull everything (the default full sync). 'invoices' bundles
// invoice_items (they resolve through the same in-run invoice map).
export const DENTALLY_SYNC_RESOURCES = ['patients', 'appointments', 'payments', 'treatment_plans', 'invoices'];
export const syncBodySchema = zod_1.z.object({
    full: zod_1.z.boolean().optional(),
    resources: zod_1.z.array(zod_1.z.enum(DENTALLY_SYNC_RESOURCES)).optional(),
});
// Ad-account selection (Google Ads / Meta Ads): the customer_ids to include in
// the marketing views. The rest are deselected. Empty array = select none.
export const adAccountSelectionSchema = zod_1.z.object({
    selected_ids: zod_1.z.array(zod_1.z.string()),
});
// GoHighLevel multi-subaccount management schemas.
export const ghlAccountCreateSchema = zod_1.z.object({
    token: zod_1.z.string().min(8),
    locationId: zod_1.z.string().min(1),
    label: zod_1.z.string().max(120).optional(),
});
export const ghlAccountUpdateSchema = zod_1.z.object({
    label: zod_1.z.string().max(120).optional(),
});
// GHL dashboard query — optional single-account/practice filter + ISO window.
// since/until default in the controller (trailing 30 days) when omitted.
export const ghlDashboardQuerySchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid().optional(),
    practiceId: zod_1.z.string().uuid().optional(),
    since: zod_1.z.string().datetime().optional(),
    until: zod_1.z.string().datetime().optional(),
});
