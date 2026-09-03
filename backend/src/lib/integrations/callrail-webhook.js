// ============================================================================
// CallRail webhook ingestion — a TRIGGER, not the source of truth.
//
// CallRail sends its Post-Call webhook ONCE per call and never resends it
// ("CallRail does not resend webhooks" — see
// .superpowers/sdd/2026-09-03-callrail-integration/callrail-api-findings.md,
// researched against the official v3 docs). Repeated failed deliveries can
// make CallRail auto-disable the integration, so once a delivery has passed
// authentication this handler ALWAYS answers 2xx — a downstream failure (a
// dead re-fetch, a DB error) is logged and swallowed here, never turned into
// an HTTP failure. That is exactly why callrail-sync.js's nightly pull is
// load-bearing rather than belt-and-braces: it is the only path that ever
// revisits a call this handler could not finish.
//
// AUTHENTICATION, two factors:
//   1. The path token (:token) — a random per-COMPANY secret minted by
//      callrailService.addAccount (integration_accounts.webhook_token),
//      resolved via integrationAccountRepository.getByWebhookToken. This is
//      the PRIMARY authentication and is always required — the same pattern
//      GoHighLevel's per-account webhook_token already uses in this codebase.
//   2. CallRail's own `Signature` header — HMAC-SHA1 (NOT SHA256 — do not
//      copy the Dentally/Emergent helper unchanged) over the RAW body,
//      Base64-encoded, keyed by a signing key CallRail mints per COMPANY
//      (viewable on that company's own Webhooks configuration page inside
//      CallRail). Verified as a SECOND factor only when a signing key has
//      been entered for THIS account — owner-settable via
//      `PATCH /api/integrations/callrail/accounts/:id { signingKey }`
//      (callrail.service.js::updateAccount). It is a CREDENTIAL, so it is
//      encrypted into the SAME `secrets` blob as the API key (there is only
//      one `secrets` column per account) — never plaintext in `config`.
//   Deliberately NOT wired through WEBHOOK_PROVIDERS / integration.service.js's
//   org-level webhook-secret scheme (see the comment on that Set, commit
//   7e73336): CallRail's key is per COMPANY. An org-level secret would force
//   every company an owner connects to share one signature — exactly the
//   coupling the per-account design removes.
//
// IDENTITY — the payload's own `id` is UNTRUSTED. CallRail's v3 API returns a
// STRING call id ("CAL8154748ae…") but the docs' own webhook example shows a
// legacy NUMERIC id (766970532) on the same field. Storing whichever shape a
// given delivery happens to carry would let the same call land under two
// different callrail_id values against UNIQUE (organisation_id, callrail_id)
// and silently double-count every call — the same failure shape that
// inflated Emergent's accepted value ~£1m before the natural-key fix (see
// memory: synthesised-identity-raw-hash). So this handler never stores the
// payload directly: it reads ONLY the id, re-fetches the CANONICAL call from
// CallRail's API by that id — the same ?fields= list callrail-sync.js's pull
// uses (CALLRAIL_FIELDS, below) — and upserts THAT. Both ingestion paths
// therefore write the identical id form, through the identical
// callrailRepository.upsertCalls, onto the identical
// (organisation_id, callrail_id) conflict target: one call, one row, however
// many times it is delivered or pulled. If the re-fetch fails, nothing is
// stored and the nightly pull collects the call instead — see ingestDelivery.
// ============================================================================
import crypto from 'node:crypto';
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
import { callrailRepository } from '../../repositories/callrail.repository.js';
import { decryptSecret } from '../crypto.js';
import { normalisePhone } from '../sheet-export/normalise.js';
import { AppError } from '../../middleware/errors.js';

const API_BASE = 'https://api.callrail.com/v3';

// Shared ?fields= list. CallRail's default calls.json / calls/{id}.json
// response omits EVERY attribution field this integration exists for
// (gclid, keywords, campaign, source, first_call, medium, the utm_* set, …).
// ONE constant, imported by BOTH this file's single-call re-fetch and
// callrail-sync.js's paginated pull, so the two ingest paths can never
// independently drift on what they ask CallRail for.
export const CALLRAIL_FIELDS = [
    // Default fields (free even without ?fields=) — listed explicitly anyway
    // so a future change to CallRail's default set can't silently drop one.
    'id', 'answered', 'business_phone_number', 'customer_city', 'customer_country',
    'customer_name', 'customer_phone_number', 'customer_state', 'direction', 'duration',
    'recording', 'recording_duration', 'recording_player', 'start_time',
    'tracking_phone_number', 'voicemail', 'agent_email',
    // Attribution fields — absent unless explicitly requested, and the entire
    // reason this integration exists.
    'gclid', 'keywords', 'campaign', 'source', 'first_call', 'company_id', 'medium',
    'landing_page_url', 'referring_url', 'tracker_id', 'lead_status',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
].join(',');

// Headers CallRail expects on every call: the quoted-token Authorization
// form from the docs, and the Request-From self-identification the docs ask
// third-party integrations to send.
export function callrailHeaders(apiKey) {
    return {
        Authorization: `Token token="${apiKey}"`,
        Accept: 'application/json',
        'Request-From': 'elevate_dental_os',
    };
}

// Re-fetch ONE call, canonical shape, by CallRail's own id — the webhook's
// half of the shared identity contract (see file header). The pull never
// calls this; it pages the list endpoint directly (callrail-sync.js).
export async function fetchCanonicalCall(apiKey, callrailAccountId, callId) {
    const url = `${API_BASE}/a/${encodeURIComponent(callrailAccountId)}/calls/${encodeURIComponent(callId)}.json?fields=${CALLRAIL_FIELDS}`;
    const res = await fetch(url, { headers: callrailHeaders(apiKey) });
    if (!res.ok) {
        throw new Error(`CallRail call fetch failed: HTTP ${res.status}`);
    }
    return res.json();
}

// Pure: a CallRail call object (from the API — ALWAYS; never the webhook's
// own delivery payload, see the IDENTITY note above) -> a callrail_calls row.
// Does NOT stamp organisation_id / practice_id / integration_account_id —
// callers stamp those from the ACCOUNT that authenticated the request, never
// from anything in the API response (rule 3 / the multi-tenant boundary).
// Returns null when the call is missing its id or start_time: rejected
// rather than stored half-formed.
export function parseCallPayload(call) {
    if (!call || typeof call !== 'object') return null;
    const callrail_id = call.id == null ? null : String(call.id);
    const started_at = call.start_time ?? null;
    if (!callrail_id || !started_at) return null;
    const phone = normalisePhone(call.customer_phone_number);
    return {
        callrail_id,
        tracking_number: call.tracking_phone_number ?? null,
        caller_number: call.customer_phone_number ?? null,
        caller_phone10: phone?.canonical ?? null,
        caller_name: call.customer_name ?? null,
        // CallRail carries no email for a phone call — always null, on every
        // row, from both ingest paths. Not a sync bug: see
        // callrail-api-findings.md §5. The cross-source dedup against
        // GoHighLevel therefore keys calls on phone10 alone; the email
        // branch of that matcher can never fire for a call.
        caller_email: null,
        caller_email_norm: null,
        started_at,
        duration_seconds: call.duration == null ? null : Number(call.duration),
        answered: call.answered ?? null,
        first_call: call.first_call ?? null,
        gclid: call.gclid ?? null,
        keywords: call.keywords ?? null,
        campaign: call.campaign ?? null,
        source: call.source ?? null,
        raw: call,
    };
}

function timingSafeEqualStr(a, b) {
    const ab = Buffer.from(String(a ?? ''), 'utf8');
    const bb = Buffer.from(String(b ?? ''), 'utf8');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Resolve + authenticate the path token. Deliberately IDENTICAL whether the
// token is unknown, belongs to another provider, or belongs to a revoked
// company — telling those apart in the response would let a client probe
// which tokens ever existed, or whether an org has a CallRail connection at
// all.
async function resolveAccount(token) {
    const account = await integrationAccountRepository.getByWebhookToken(token);
    if (!account || account.provider !== 'callrail' || account.status === 'revoked') {
        throw new AppError('not found', 404);
    }
    return account;
}

// Decrypt the account's secrets blob ONCE per delivery (api_key + the
// optional signing_key live in the same encrypted JSON — there is only one
// `secrets` column per account row). Never throws: a corrupt/missing blob
// degrades to "no credentials, no signing key" rather than a 500, since a
// downstream failure here must still answer 2xx (see file header).
function decryptAccountSecrets(account) {
    try {
        return JSON.parse(decryptSecret(account.secrets)) ?? {};
    } catch (err) {
        console.error('[callrail-webhook] could not decrypt account credentials', {
            accountId: account.id, error: err.message,
        });
        return {};
    }
}

// Second-factor signature check. A no-op (never throws) when this account
// has no signing key on file — the path token remains the sole
// authentication for that company until the owner sets one via
// PATCH .../accounts/:id { signingKey }.
//
// DELIBERATE ASYMMETRY, reviewed and kept: an unknown token and a revoked
// company's token answer the SAME 404 (resolveAccount, above) so a client
// can't tell those apart. A WRONG SIGNATURE on a VALID token answers 401,
// a different and more specific outcome — collapsing it into 404 would hide
// a genuine misconfiguration (an owner whose signing key is wrong would see
// "not found" with no way to tell why deliveries stopped). The token itself
// is 24 random bytes, so a 401 leaking "this token is valid" is not the same
// risk as a 404 leaking "this org has no CallRail connection".
function verifySignature(secrets, account, rawBody, signatureHeader) {
    const key = secrets?.signing_key;
    if (!key) return;
    const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
    const expected = crypto.createHmac('sha1', key).update(raw).digest('base64');
    if (!timingSafeEqualStr(signatureHeader, expected)) {
        console.warn('[callrail-webhook] signature rejected', { accountId: account.id });
        throw new AppError('invalid signature', 401);
    }
}

// Everything from here on must NEVER throw / produce a non-2xx: CallRail can
// auto-disable an integration after repeated failed deliveries, and never
// resends a dropped one — the nightly pull (callrail-sync.js) is what
// recovers anything lost here. Every branch below returns a plain object.
async function ingestDelivery(account, secrets, rawBody) {
    let payload;
    try {
        const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
        payload = JSON.parse(text);
    } catch {
        return { received: true, stored: false, reason: 'invalid_json' };
    }

    // The ONLY thing trusted from the payload: which call to re-fetch. Never
    // organisation_id, practice_id, or any other field — those are stamped
    // from `account` below, never from anything the payload claims.
    const callId = payload?.id;
    if (callId == null) {
        return { received: true, stored: false, reason: 'no_call_id' };
    }

    const apiKey = secrets?.api_key;
    if (!apiKey) {
        return { received: true, stored: false, reason: 'no_credentials' };
    }

    let call;
    try {
        call = await fetchCanonicalCall(apiKey, account.external_account_id, callId);
    } catch (err) {
        // The RULING (file header): never store the payload's own id shape.
        // If the re-fetch fails, store nothing and let the pull collect it.
        console.warn('[callrail-webhook] canonical re-fetch failed, deferring to the pull', {
            accountId: account.id, error: err.message,
        });
        return { received: true, stored: false, reason: 'refetch_failed' };
    }

    const row = parseCallPayload(call);
    if (!row) {
        console.warn('[callrail-webhook] canonical call missing id/start_time', {
            accountId: account.id, callId,
        });
        return { received: true, stored: false, reason: 'incomplete_call' };
    }

    try {
        await callrailRepository.upsertCalls(account.organisation_id, [{
            ...row,
            practice_id: account.practice_id ?? null,
            integration_account_id: account.id,
        }]);
    } catch (err) {
        console.error('[callrail-webhook] upsert failed', { accountId: account.id, error: err.message });
        return { received: true, stored: false, reason: 'upsert_failed' };
    }
    return { received: true, stored: true };
}

// The controller's entry point. token/rawBody/signatureHeader come straight
// off the request (app.js mounts express.raw on /webhooks/callrail, so
// rawBody is a Buffer — both for the HMAC and to preserve the exact bytes
// CallRail signed). Authentication failures (401/404) DO reach the client as
// a real HTTP error: CallRail's auto-disable risk is about repeated failed
// DELIVERIES, not about rejecting a request that never authenticated, and a
// silently-accepted forged delivery would be worse than a lost one.
export async function handleWebhook(token, rawBody, signatureHeader) {
    const account = await resolveAccount(token);
    const secrets = decryptAccountSecrets(account);
    verifySignature(secrets, account, rawBody, signatureHeader);
    return ingestDelivery(account, secrets, rawBody);
}
