// ============================================================================
// CallRail companies — owner-only management of N CallRail companies per org,
// one per practice, exactly like GoHighLevel multi-subaccount (see
// ghl-account.service.js, the shape this mirrors): each company carries its
// own encrypted API key on an integration_accounts row plus a random webhook
// token, minted the same way (crypto.randomBytes(24).toString('hex')) and
// decorated with the same webhook_url pattern
// (${BACKEND_PUBLIC_URL||APP_URL}/webhooks/callrail/:token).
//
// ACCOUNT vs COMPANY. CallRail's hierarchy is Account -> Company -> Calls,
// verified against the official v3 docs (see
// docs/superpowers/specs/2026-09-04-callrail-api-facts.md). Every
// integration_accounts row here is one COMPANY:
// external_account_id = the CallRail COMPANY id (what the unique
// (org, provider, external_account_id) constraint correctly dedupes N
// companies on), and config.account_id = the CallRail ACCOUNT id that
// company lives under (every `/v3/a/{...}` URL needs it — see
// callrail-provider.js / callrail-sync.js / callrail-webhook.js). An earlier
// version of this file conflated the two, which made the documented
// four-company connect flow impossible and, when an owner pasted an
// account-wide id anyway, attributed every company's calls to one practice.
//
// UNLIKE GHL, a CallRail company's practice mapping is denormalised onto
// every call it has already fetched (callrail_calls.practice_id) — there is
// no join at read time. That means changing a company's practice is a real
// UPDATE across its call history (restampPractice), not just a metadata
// change; see updateAccount below.
//
// RESOLVED (was a risk flag here): sourceBreakdown() first used PostgREST's
// aggregate functions in `select` (`col.count()`), on the assumption that
// PostgREST v12.1+ enables them by default. It does not on this project.
// Checked against the hosted REST endpoint rather than argued from version
// numbers: the aggregate request answers HTTP 400 `PGRST123: Use of
// aggregate functions is not allowed`, while the identical request WITHOUT
// aggregates answers 401 — so the rejection is at parse time, before the
// role check, and service_role would have hit it exactly as anon did. In
// production that was a 400 on the Integrations panel, not a slow query.
// It is now the RPC callrail_source_breakdown (migration 000155), which is
// what every other aggregate in this codebase does.
// ============================================================================
import crypto from "node:crypto";
import * as supabase_1 from "../lib/supabase.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { callrailRepository } from "../repositories/callrail.repository.js";
import { callrailProvider } from "../lib/integrations/callrail-provider.js";
import { syncAccount as pullCallrailAccount } from "../lib/integrations/callrail-sync.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import { assertOrgOwns } from "../lib/tenant-guard.js";
import { AppError } from "../middleware/errors.js";

const PROVIDER = 'callrail';

function webhookUrlFor(token) {
    if (!token) return null;
    const base = process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || 'http://localhost:8080';
    return `${base}/webhooks/callrail/${token}`;
}

// Practice names for a bounded set of ids — never more than the number of
// CallRail companies an org has. Not a callrail.repository.js method: that
// file is scoped to callrail_calls only (see its header). A direct
// serviceClient reference-data lookup from a service is already established
// elsewhere (org-meta.service.js, features.service.js, notification.service.js,
// comm.service.js, training.service.js, quickbooks-account.service.js).
async function practiceNamesFor(orgId, practiceIds) {
    const ids = [...new Set((practiceIds ?? []).filter((id) => id != null))];
    const map = new Map();
    if (ids.length === 0) return map;
    const { data, error } = await supabase_1.serviceClient
        .from('practices')
        .select('id, name')
        .eq('organisation_id', orgId)
        .in('id', ids);
    if (error) throw new AppError('Could not load practice names', 500);
    for (const p of data ?? []) map.set(p.id, p.name);
    return map;
}

async function countsFor(orgId, accountId) {
    const [c] = await callrailRepository.callCountsByAccount(orgId, [accountId]);
    return c ?? { integrationAccountId: accountId, callCount: 0, lastCallAt: null };
}

// The exact shape the panel (and its api.ts CallRailAccount type) consumes.
// Never reads account.secrets — integrationAccountRepository's SAFE_COLS
// doesn't select it in the first place — which also means the api_key and
// signing_key updateAccount stores inside that encrypted blob are never on
// this DTO either, on any read path. Whether a signing key IS configured is
// tracked as a plain (non-secret) config.has_signing_key flag precisely so
// this can answer that without ever touching secrets — see updateAccount.
function toAccountDTO(account, counts, practiceName) {
    return {
        id: account.id,
        label: account.label ?? null,
        // Two different CallRail ids, deliberately both surfaced: the
        // ACCOUNT this company lives under (config.account_id — every
        // `/v3/a/{...}` URL needs it) and the COMPANY itself
        // (external_account_id — what practice mapping and calls.json's
        // company_id filter key off). Conflating these was the root defect
        // this integration shipped with.
        callrailAccountId: account.config?.account_id ?? null,
        callrailCompanyId: account.external_account_id,
        practiceId: account.practice_id ?? null,
        practiceName: practiceName ?? null,
        status: account.status,
        lastSyncedAt: account.last_sync_at ?? null,
        lastError: account.last_error ?? null,
        webhookUrl: webhookUrlFor(account.webhook_token),
        signingKeyConfigured: account.config?.has_signing_key === true,
        callCount: counts?.callCount ?? 0,
        lastCallAt: counts?.lastCallAt ?? null,
    };
}

export const callrailService = {
    // The payload GET /api/integrations/callrail returns — Task 2's panel's
    // entire data source. A company connected but not yet mapped to a
    // practice is listed (never hidden) with practiceId/practiceName null,
    // so the owner can see it is unassigned rather than have its calls
    // silently attributed nowhere.
    async status(orgId) {
        const [marker, allAccounts, sourceBreakdown] = await Promise.all([
            integrationRepository.getByProvider(orgId, PROVIDER),
            integrationAccountRepository.list(orgId, PROVIDER),
            callrailRepository.sourceBreakdown(orgId),
        ]);

        // A removed company is soft-revoked, not deleted: markRevoked nulls its
        // secrets but keeps the row, so its calls keep their
        // integration_account_id instead of being orphaned — the same reason
        // the FK is ON DELETE SET NULL rather than CASCADE.
        //
        // It must not still be LISTED, though. An owner who clicks Disconnect
        // and then sees the company sitting in the panel has been told the
        // action failed. The row stays in the database; it leaves the screen.
        // (sourceBreakdown is deliberately org-wide and still counts a revoked
        // company's historical calls — those calls really did happen.)
        const accounts = allAccounts.filter((a) => a.status !== 'revoked');

        const [counts, practiceNames] = await Promise.all([
            callrailRepository.callCountsByAccount(orgId, accounts.map((a) => a.id)),
            practiceNamesFor(orgId, accounts.map((a) => a.practice_id)),
        ]);
        const countsById = new Map(counts.map((c) => [c.integrationAccountId, c]));

        return {
            connected: marker?.status === 'active',
            accounts: accounts.map((a) => toAccountDTO(
                a,
                countsById.get(a.id),
                a.practice_id ? (practiceNames.get(a.practice_id) ?? null) : null,
            )),
            sourceBreakdown,
        };
    },

    // Step 1 of the Add-company flow: list every company under a CallRail
    // ACCOUNT so the owner PICKS one instead of typing an opaque id. Never
    // persists anything — a pure passthrough verification call, same
    // failure-message discipline as addAccount below (never leaks the key).
    async listCompanies(orgId, { apiKey, callrailAccountId } = {}) {
        try {
            return await callrailProvider.listCompanies(apiKey, callrailAccountId);
        } catch (err) {
            throw new AppError(err.message, 400);
        }
    },

    // Validates the key against CallRail FIRST — a bad key must never be
    // stored, logged, or echoed — via verify(), which in one request proves
    // BOTH the account id and the company id (CallRail's hierarchy is
    // Account -> Company -> Calls; every `/v3/a/{...}` URL takes the ACCOUNT
    // id, so that id is stored on config.account_id, never on
    // external_account_id, which holds the COMPANY id — see toAccountDTO's
    // own comment for why both are kept).
    //
    // FIX for "disconnect and add it again" 500ing on a live company: a
    // revoked row for the SAME company is UPDATED (reconnect, reusing the
    // row so its call history keeps its integration_account_id) rather than
    // a second insert racing the unique constraint; a row that is NOT
    // revoked 409s with a message the owner can act on. Mirrors
    // ghl-account.service.js's addAccount exactly.
    async addAccount(orgId, { apiKey, callrailAccountId, callrailCompanyId, label, practiceId } = {}) {
        if (!apiKey || !String(apiKey).trim()) throw new AppError('apiKey is required', 400);
        const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
        if (!accountId) throw new AppError('callrailAccountId is required', 400);
        const companyId = callrailCompanyId == null ? '' : String(callrailCompanyId).trim();
        if (!companyId) throw new AppError('callrailCompanyId is required', 400);

        let verifiedName;
        try {
            verifiedName = await callrailProvider.verify(apiKey, accountId, companyId);
        } catch (err) {
            // verify()'s own message is already safe to show the owner (never
            // contains the key, on any branch) — rethrown as a 400, not a 500.
            throw new AppError(err.message, 400);
        }
        const name = (label && String(label).trim()) || verifiedName || 'CallRail';

        if (practiceId) await assertOrgOwns(orgId, 'practices', practiceId, 'Practice');

        const secrets = encryptSecret(JSON.stringify({ api_key: String(apiKey).trim() }));
        const webhook_token = crypto.randomBytes(24).toString('hex');

        const dup = await integrationAccountRepository.getByLocation(orgId, PROVIDER, companyId);
        if (dup && dup.status !== 'revoked') {
            throw new AppError('That CallRail company is already connected', 409);
        }

        let account;
        if (dup) {
            account = await integrationAccountRepository.update(orgId, dup.id, {
                label: name, secrets, status: 'active', last_error: null,
                practice_id: practiceId ?? null,
                config: { account_id: accountId },
                webhook_token,
            });
        } else {
            account = await integrationAccountRepository.insert(orgId, {
                provider: PROVIDER,
                external_account_id: companyId,
                practice_id: practiceId ?? null,
                label: name,
                secrets,
                config: { account_id: accountId },
                status: 'active',
                webhook_token,
            });
        }

        await integrationRepository.upsert(orgId, PROVIDER, { status: 'active', last_error: null });
        invalidateGating(orgId);

        // First pull after connecting (or reconnecting) — fire-and-forget,
        // mirroring gohighlevel-sync.js's bootstrapAccount. FULL_DAYS, not
        // the incremental nightly window: this is the one moment a fresh
        // company's whole recent history is worth fetching in full rather
        // than waiting on tonight's cron or a manual "Sync now".
        integrationAccountRepository.getByIdWithSecrets(orgId, account.id)
            .then((full) => full && pullCallrailAccount(orgId, full, () => {}, { full: true }))
            .catch((err) => console.error('[callrail] first pull after connect failed:', err?.message || err));

        const practiceName = practiceId
            ? (await practiceNamesFor(orgId, [practiceId])).get(practiceId) ?? null
            : null;
        return toAccountDTO(account, { callCount: 0, lastCallAt: null }, practiceName);
    },

    // label is a normal owner power; practiceId is agency-actor-gated by the
    // CONTROLLER (not here — see integration.controller.js), matching
    // ghlAccountUpdate's practice_id rule. Changing the practice restamps
    // every call already fetched by this company, so a correction takes
    // effect on history and not only on what arrives next.
    //
    // signingKey is a THIRD kind of field, distinct from both: a credential
    // (encrypted, never returned — see toAccountDTO's own comment), but NOT
    // agency-gated — pasting your own CallRail signing key is ordinary
    // owner self-service, not a mapping decision (the controller's
    // isAgencyActor check only inspects practiceId, so this flows through
    // ungated by construction). `null` clears a previously-set key.
    //
    // apiKey is a FOURTH kind: the fix for "a rotated API key can never be
    // replaced" — before this, the only advertised recovery from a rotated
    // key was disconnect-and-reconnect (CallRailPanel.tsx's own banner
    // copy), which 500'd because the revoked row still held the unique
    // (org, provider, company) slot. A corrected key re-verifies against
    // THIS company's existing account/company ids — same discipline as
    // addAccount — before it is ever persisted, so rotation needs no
    // disconnect at all. Also NOT agency-gated: ordinary owner self-service.
    async updateAccount(orgId, id, { practiceId, label, signingKey, apiKey } = {}) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new AppError('account not found', 404);

        const patch = {};
        if (label !== undefined) patch.label = label;

        let practiceChanged = false;
        let normalisedPracticeId = existing.practice_id ?? null;
        if (practiceId !== undefined) {
            if (practiceId) await assertOrgOwns(orgId, 'practices', practiceId, 'Practice');
            normalisedPracticeId = practiceId ?? null;
            practiceChanged = (existing.practice_id ?? null) !== normalisedPracticeId;
            patch.practice_id = normalisedPracticeId;
        }

        let nextApiKey;
        if (apiKey !== undefined) {
            const trimmed = apiKey == null ? '' : String(apiKey).trim();
            if (!trimmed) throw new AppError('apiKey cannot be empty', 400);
            const accountId = existing.config?.account_id;
            const companyId = existing.external_account_id;
            if (!accountId || !companyId) {
                throw new AppError('This company is missing its CallRail account id — disconnect and add it again', 400);
            }
            try {
                await callrailProvider.verify(trimmed, accountId, companyId);
            } catch (err) {
                throw new AppError(err.message, 400);
            }
            nextApiKey = trimmed;
            // A key rotation is exactly the kind of fix that should also
            // clear a stale failure — the owner just proved the new key works.
            patch.status = 'active';
            patch.last_error = null;
        }

        let signingKeyConfiguredNow = existing.config?.has_signing_key === true;
        if (signingKey !== undefined || nextApiKey !== undefined) {
            // integration_accounts has ONE `secrets` column — api_key and
            // signing_key share it, so a re-encrypt must round-trip through
            // the EXISTING blob rather than overwrite it, or updating one
            // would silently erase the other. getById (SAFE_COLS) above
            // never selects secrets, hence the separate fetch here — only
            // when a credential is actually being touched.
            const withSecrets = await integrationAccountRepository.getByIdWithSecrets(orgId, id);
            let current = {};
            try {
                current = JSON.parse(decryptSecret(withSecrets?.secrets)) ?? {};
            } catch {
                // Corrupt/missing secrets: proceed from an empty base rather
                // than fail the whole update — the owner is trying to FIX
                // credentials, not preserve an unreadable blob.
            }
            const next = { ...current };
            if (nextApiKey !== undefined) next.api_key = nextApiKey;
            if (signingKey !== undefined) {
                if (signingKey === null) delete next.signing_key;
                else next.signing_key = signingKey;
                signingKeyConfiguredNow = signingKey != null;
            }
            patch.secrets = encryptSecret(JSON.stringify(next));
        }

        const updated = Object.keys(patch).length > 0
            ? await integrationAccountRepository.update(orgId, id, patch)
            : existing;

        // has_signing_key is a plain (non-secret) flag, never the key itself
        // — kept so status()/toAccountDTO can answer "is a signing key
        // configured" without ever reading `secrets`. mergeConfig (not a
        // raw patch.config write) so it can never clobber config.account_id.
        if (signingKey !== undefined) {
            updated.config = await integrationAccountRepository.mergeConfig(orgId, id, { has_signing_key: signingKeyConfiguredNow });
        }

        if (practiceChanged) {
            // practice_id is denormalised onto callrail_calls (migration
            // 000154) precisely so a read never needs the join — which means
            // a mapping correction is a real UPDATE here, scoped by BOTH
            // organisation_id and integration_account_id so it can never
            // touch another company's — or another org's — calls.
            await callrailRepository.restampPractice(orgId, id, normalisedPracticeId);
        }

        const counts = await countsFor(orgId, id);
        const practiceName = updated.practice_id
            ? (await practiceNamesFor(orgId, [updated.practice_id])).get(updated.practice_id) ?? null
            : null;
        return toAccountDTO(updated, counts, practiceName);
    },

    // Soft-revoke, matching every other multi-account provider in this
    // codebase (GoHighLevel's ghlAccountService.removeAccount, QuickBooks's
    // quickbooksAccountService.removeAccount) — the row stays, visible in the
    // list as 'revoked', its secret nulled by markRevoked. callrail_calls is
    // NEVER touched here: a call outlives the company that fetched it by
    // design (migration 000154's ON DELETE SET NULL exists for exactly this —
    // a key rotation or reconnect must not wipe call history). Reconnecting
    // (addAccount, above) UPDATES this same row rather than inserting a
    // second one, so "disconnect and add it again" now actually works.
    async removeAccount(orgId, id) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new AppError('account not found', 404);
        await integrationAccountRepository.markRevoked(orgId, id);
        const remaining = await integrationAccountRepository.list(orgId, PROVIDER);
        if (!remaining.some((a) => a.status === 'active')) {
            await integrationRepository.markRevoked(orgId, PROVIDER);
        }
        invalidateGating(orgId);
        return { removed: true };
    },

    // "Sync" for one company (the panel's per-row button) — a MANUAL
    // per-company sync, so it always pulls the wide FULL_DAYS window rather
    // than the incremental nightly one (opts.full: true). getByIdWithSecrets,
    // not getById: the pull needs the encrypted API key, and callrail-sync's
    // syncAccount(orgId, account, ...) takes the FULL account row, never an
    // id it would have to re-resolve. `truncated` is surfaced (was silently
    // dropped before) — a clamped pagination cap is still worth knowing about
    // on a manual sync the owner is watching.
    async syncAccount(orgId, id) {
        const existing = await integrationAccountRepository.getByIdWithSecrets(orgId, id);
        if (!existing) throw new AppError('account not found', 404);
        const result = await pullCallrailAccount(orgId, existing, () => {}, { full: true });
        return { ingested: result.ingested ?? 0, truncated: result.truncated ?? false };
    },
};
