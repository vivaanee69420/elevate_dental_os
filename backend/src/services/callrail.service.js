// ============================================================================
// CallRail companies — owner-only management of N CallRail companies per org,
// one per practice, exactly like GoHighLevel multi-subaccount (see
// ghl-account.service.js, the shape this mirrors): each company carries its
// own encrypted API key on an integration_accounts row plus a random webhook
// token, minted the same way (crypto.randomBytes(24).toString('hex')) and
// decorated with the same webhook_url pattern
// (${BACKEND_PUBLIC_URL||APP_URL}/webhooks/callrail/:token).
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

// The exact shape Task 2's panel (and its api.ts CallRailAccount type)
// consumes. Never reads account.secrets — integrationAccountRepository's
// SAFE_COLS doesn't select it in the first place — which also means the
// signing_key updateAccount stores inside that same encrypted blob is never
// on this DTO either, on any read path.
function toAccountDTO(account, counts, practiceName) {
    return {
        id: account.id,
        label: account.label ?? null,
        callrailAccountId: account.external_account_id,
        practiceId: account.practice_id ?? null,
        practiceName: practiceName ?? null,
        status: account.status,
        lastSyncedAt: account.last_sync_at ?? null,
        lastError: account.last_error ?? null,
        webhookUrl: webhookUrlFor(account.webhook_token),
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

    // Validates the key against CallRail FIRST — a bad key must never be
    // stored, logged, or echoed. Only then encrypts it, creates the
    // lightweight provider marker row if absent (mirrors GHL), and inserts
    // the integration_accounts row with a fresh random webhook_token.
    async addAccount(orgId, { apiKey, callrailAccountId, label, practiceId } = {}) {
        if (!apiKey || !String(apiKey).trim()) throw new AppError('apiKey is required', 400);
        const accountId = callrailAccountId == null ? '' : String(callrailAccountId).trim();
        if (!accountId) throw new AppError('callrailAccountId is required', 400);

        let verifiedName;
        try {
            verifiedName = await callrailProvider.verify(apiKey, accountId);
        } catch (err) {
            // verify()'s own message is already safe to show the owner (never
            // contains the key, on any branch) — rethrown as a 400, not a 500.
            throw new AppError(err.message, 400);
        }
        const name = (label && String(label).trim()) || verifiedName || 'CallRail';

        if (practiceId) await assertOrgOwns(orgId, 'practices', practiceId, 'Practice');

        const secrets = encryptSecret(JSON.stringify({ api_key: String(apiKey).trim() }));
        const webhook_token = crypto.randomBytes(24).toString('hex');

        await integrationRepository.upsert(orgId, PROVIDER, { status: 'active', last_error: null });

        const account = await integrationAccountRepository.insert(orgId, {
            provider: PROVIDER,
            external_account_id: accountId,
            practice_id: practiceId ?? null,
            label: name,
            secrets,
            config: {},
            status: 'active',
            webhook_token,
        });

        invalidateGating(orgId);

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
    async updateAccount(orgId, id, { practiceId, label, signingKey } = {}) {
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

        if (signingKey !== undefined) {
            // integration_accounts has ONE `secrets` column — api_key and
            // signing_key share it, so a re-encrypt must round-trip through
            // the EXISTING blob rather than overwrite it, or a signing-key
            // update would silently erase the API key. getById (SAFE_COLS)
            // above never selects secrets, hence the separate fetch here —
            // only when signingKey is actually being touched.
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
            if (signingKey === null) delete next.signing_key;
            else next.signing_key = signingKey;
            patch.secrets = encryptSecret(JSON.stringify(next));
        }

        const updated = Object.keys(patch).length > 0
            ? await integrationAccountRepository.update(orgId, id, patch)
            : existing;

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
    // a key rotation or reconnect must not wipe call history).
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

    // "Sync" for one company (Task 2's per-row button). getByIdWithSecrets,
    // not getById: the pull needs the encrypted API key, and callrail-sync's
    // syncAccount(orgId, account, ...) takes the FULL account row, never an
    // id it would have to re-resolve.
    async syncAccount(orgId, id) {
        const existing = await integrationAccountRepository.getByIdWithSecrets(orgId, id);
        if (!existing) throw new AppError('account not found', 404);
        const result = await pullCallrailAccount(orgId, existing);
        return { ingested: result.ingested ?? 0 };
    },
};
