// ============================================================================
// Integration model — Zod schemas + inferred types.
// ============================================================================
import * as zod_1 from "zod";
export const integrationConnectSchema = zod_1.z.object({
    provider: zod_1.z.string(),
    redirect_url: zod_1.z.string().url().optional(),
    apiKey: zod_1.z.string().optional(),
    baseUrl: zod_1.z.string().url().optional(),
    method: zod_1.z.enum(['oauth', 'key']).optional(),
});
export const emergentPracticeMapSchema = zod_1.z.object({
    business_id: zod_1.z.string().min(1),
    practice_id: zod_1.z.string().uuid().nullable(),
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
// CallRail multi-company management schemas. CallRail's hierarchy is
// Account -> Company -> Calls: callrailAccountId is the CallRail ACCOUNT id
// (shaped "ACC8154748ae…", stored on config.account_id — every
// `/v3/a/{...}` URL needs it), callrailCompanyId is the CallRail COMPANY id
// (stored on integration_accounts.external_account_id — the value the
// unique-per-org constraint dedupes on, and what calls.json's company_id
// filter and practice mapping key off). One company = one API key, one
// practice — label is REQUIRED on create (unlike GHL's optional label) per
// the frontend contract; practiceId is optional/nullable on both and is an
// agency-actor-only field enforced in the controller, not here.
export const callrailAccountCreateSchema = zod_1.z.object({
    apiKey: zod_1.z.string().min(1),
    callrailAccountId: zod_1.z.string().min(1),
    callrailCompanyId: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1).max(120),
    practiceId: zod_1.z.string().uuid().nullable().optional(),
});
// apiKey is optional here (unlike create) — the FIX for "a rotated API key
// can never be replaced": updateAccount re-verifies it against THIS
// company's EXISTING account/company ids (already on file, not re-supplied
// here — rotating the key is not the same operation as re-pointing a row at
// a different CallRail company, which this schema deliberately does not
// support) before persisting, same discipline as addAccount.
export const callrailAccountUpdateSchema = zod_1.z.object({
    apiKey: zod_1.z.string().min(1).optional(),
    practiceId: zod_1.z.string().uuid().nullable().optional(),
    label: zod_1.z.string().min(1).max(120).optional(),
    // Second-factor webhook signature verification (see
    // callrail-webhook.js's file header). A credential, encrypted into the
    // account's `secrets` blob — never config — so it is a plain string, not
    // an agency-actor field: a tenant owner pasting their own CallRail
    // signing key is ordinary self-service, not a practice-mapping decision
    // (enforced by omission from the controller's isAgencyActor gate, which
    // only checks practiceId). `null` clears a previously-set key.
    signingKey: zod_1.z.string().min(1).max(200).nullable().optional(),
});
// Add-company step 1: list every company under a CallRail account, so the
// owner PICKS a company instead of typing an opaque id (removes the whole
// class of paste-the-wrong-id error the original flow shipped with).
export const callrailListCompaniesSchema = zod_1.z.object({
    apiKey: zod_1.z.string().min(1),
    callrailAccountId: zod_1.z.string().min(1),
});

// Window for the one-off Dentally payment-status repair. Both bounds required:
// a lone bound would silently repair a different span than intended, and this
// walks a remote API, so the caller must say exactly what it is asking for.
export const dentallyPaymentRepairSchema = zod_1.z.object({
    since: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'since must be YYYY-MM-DD'),
    until: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'until must be YYYY-MM-DD'),
}).refine((v) => v.since <= v.until, { message: 'since must not be after until' });
