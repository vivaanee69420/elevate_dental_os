// ============================================================================
// CallRail scheduled pull — backfill and the gaps the real-time webhook
// (callrail-webhook.js) leaves.
//
// A WEBHOOK DELIVERS ONCE. "CallRail does not resend webhooks" (see
// .superpowers/sdd/2026-09-03-callrail-integration/callrail-api-findings.md).
// Anything lost to a deploy, a restart, a transient DB error, or a call that
// simply predates a company's connection is gone from the webhook path
// permanently. This pull is therefore LOAD-BEARING, not belt-and-braces — it
// is the only path that ever revisits those calls.
//
// PER ACCOUNT, NOT PER ORG (mirrors gohighlevel-sync.js's syncAccount/
// syncAllOrgs pair): credentials live on integration_accounts, one row per
// CallRail company, so there is no org-level key to sync with.
// listAllSyncable selects status IN ('active','failed') — never 'active'
// alone — so one transient error (a network blip, a 429 run that exhausts
// its retries) does not freeze a company out of every future run; the next
// successful syncAccount flips it back to 'active' via
// integrationAccountRepository.markSynced (see the "GHL failed accounts
// never retried" incident this same guard exists for elsewhere).
//
// ONE WRITE PATH, ONE IDENTITY. Both this pull and the webhook call
// callrailRepository.upsertCalls, both build their row via
// parseCallPayload (imported from callrail-webhook.js, which owns it — see
// that file's IDENTITY note), and both request the identical CALLRAIL_FIELDS
// list. A call the webhook already ingested and this pull re-fetches
// collapses to the SAME row on the (organisation_id, callrail_id) conflict
// target — never a second one.
//
// PAGINATION. Relative pagination, per the docs: follow `next_page` and stop
// the moment `has_next_page` is false. Deliberately never a "short page"
// heuristic — CallRail's per_page cap (250, the documented max for this
// endpoint) means a full page proves nothing about whether more exist, and a
// page that happens to come back short is not evidence there are no more
// (see the PostgREST 1000-row-cap trap this codebase has hit before: "page
// on a unique key, stop on an empty page, not a short one" — the same
// discipline, applied to the signal THIS api actually gives us).
//
// RATE LIMIT. 1,000/hour and 10,000/day, signalled as HTTP 429 — NOT 403
// (Dentally's scheme; do not copy that connector's handling here). Bounded
// retry with backoff, honouring Retry-After when CallRail sends one.
//
// WINDOW. Trailing INCREMENTAL_DAYS on the nightly cron, trailing FULL_DAYS
// on a manual reconnect / full pull (opts.full) — mirrors google-ads-sync.js.
// ============================================================================
import { integrationAccountRepository } from '../../repositories/integration-account.repository.js';
import { callrailRepository } from '../../repositories/callrail.repository.js';
import { decryptSecret } from '../crypto.js';
import { CALLRAIL_FIELDS, callrailHeaders, parseCallPayload } from './callrail-webhook.js';
import { londonDaysAgo, londonYmd } from '../tz.js';
// Capture is a no-op when Sentry was never init'd (no SENTRY_DSN, e.g. local
// and tests), so this is safe to import unconditionally (mirrors
// gohighlevel-sync.js's own use of this import).
import * as Sentry from '@sentry/node';

const API_BASE = 'https://api.callrail.com/v3';
const PER_PAGE = 250;             // CallRail's documented max per_page for calls.json
const MAX_PAGES = 200;            // safety cap (~50k calls/account) — never hit in practice
const INCREMENTAL_DAYS = 90;      // nightly cron window: trailing 3 months
// Manual reconnect / full pull. Well inside CallRail's 25-month retention —
// a request reaching past that is refused outright, not silently truncated.
const FULL_DAYS = 183;
const RETRY_BASE_MS = Number(process.env.CALLRAIL_RETRY_BASE_MS ?? 1000);
const MAX_RETRIES = 3;

async function fetchCallsPage(apiKey, callrailAccountId, { page, startDate, endDate }) {
    const url = new URL(`${API_BASE}/a/${encodeURIComponent(callrailAccountId)}/calls.json`);
    url.searchParams.set('relative_pagination', 'true');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('fields', CALLRAIL_FIELDS);
    if (page) url.searchParams.set('page', String(page));

    // start_date/end_date are REQUIRED, not optional-with-a-guard. When a
    // request carries no date parameters at all, CallRail does not return
    // everything — it silently applies `date_range=recent`, the previous SEVEN
    // days. A refactor that let either of these go undefined would turn the
    // 90-day nightly window into a 7-day one, with a 200 and no error to
    // notice. Fail loudly instead.
    //
    // Both bounds are INCLUSIVE per the vendor docs: start_date=YYYY-MM-DD
    // means from midnight that day, end_date=YYYY-MM-DD means up to 23:59:59
    // that day. Interpreted in the CallRail account's own time zone, which is
    // harmless here — the window is trailing and generous, re-pulls are
    // idempotent, and every stored timestamp comes from the payload's
    // start_time rather than from this bucketing.
    if (!startDate || !endDate) {
        throw new Error('CallRail calls fetch requires start_date and end_date');
    }
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers: callrailHeaders(apiKey) });
        if (res.status === 429 && attempt < MAX_RETRIES) {
            const retryAfter = Number(res.headers?.get?.('retry-after'));
            const wait = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : RETRY_BASE_MS * 2 ** attempt;
            await new Promise((resolve) => { setTimeout(resolve, wait); });
            continue;
        }
        if (!res.ok) {
            throw new Error(`CallRail calls fetch failed: HTTP ${res.status}`);
        }
        return res.json();
    }
    throw new Error('CallRail calls fetch failed: exhausted 429 retries');
}

// Pages calls.json for ONE company over [startDate, endDate] (London
// YYYY-MM-DD, inclusive). Stops the instant a page reports
// has_next_page: false — see the PAGINATION note in the file header for why
// that, and only that, is the termination condition. Returns the requests
// actually made so callers/tests can assert pager behaviour, not just the
// row total (a row total alone can't distinguish a correct pager from one
// that stops on a short page).
export async function fetchAllCalls(apiKey, callrailAccountId, { startDate, endDate } = {}) {
    const calls = [];
    let page;
    let requests = 0;
    let truncated = false;
    for (;;) {
        const data = await fetchCallsPage(apiKey, callrailAccountId, { page, startDate, endDate });
        requests += 1;
        const rows = Array.isArray(data?.calls) ? data.calls : [];
        calls.push(...rows);
        if (!data?.has_next_page || !data?.next_page) break;
        page = data.next_page;
        if (requests >= MAX_PAGES) {
            // The cap was hit while CallRail was still saying has_next_page —
            // there IS more data waiting, and it is being dropped silently
            // unless something says so. At the owner's real volume (~50
            // calls/month against a ~50k-call cap) this never fires; a much
            // larger org would otherwise lose data with zero signal.
            truncated = true;
            console.warn(`[callrail] account ${callrailAccountId}: hit the ${MAX_PAGES}-page pagination cap with more data still waiting (has_next_page was still true) — this pull is truncated`);
            break;
        }
    }
    return { calls, requests, truncated };
}

// Sync ONE CallRail company. `account` is the FULL row — secrets included —
// exactly what integrationAccountRepository.getByIdWithSecrets /
// listAllSyncable('callrail') return; callers must never pass the SAFE_COLS
// shape. Every row written carries THIS account's organisation_id and
// practice_id — never a value from the API response (rule 3 / the
// multi-tenant boundary): a call fetched with company A's key can only ever
// land under company A's org and practice.
export async function syncAccount(orgId, account, onProgress = () => {}, opts = {}) {
    if (!account || account.status === 'revoked' || !account.secrets) {
        return { ingested: 0, skipped: 'inactive' };
    }

    let apiKey;
    try {
        apiKey = JSON.parse(decryptSecret(account.secrets))?.api_key;
    } catch (err) {
        try {
            await integrationAccountRepository.markFailed(orgId, account.id, `credentials: ${err.message}`);
        } catch (markErr) {
            console.error(`[callrail] account ${account.id} markFailed failed:`, markErr?.message || markErr);
        }
        throw err;
    }
    const callrailAccountId = account.external_account_id;
    if (!apiKey || !callrailAccountId) {
        return { ingested: 0, skipped: 'no_credentials' };
    }

    const windowDays = opts.full ? FULL_DAYS : INCREMENTAL_DAYS;
    const startDate = londonDaysAgo(windowDays);
    const endDate = londonYmd();

    try {
        const { calls, requests, truncated } = await fetchAllCalls(apiKey, callrailAccountId, { startDate, endDate });
        onProgress({ phase: 'calls', count: calls.length, requests, truncated });

        const rows = [];
        for (const call of calls) {
            const row = parseCallPayload(call);
            // Missing id/start_time — rejected, not stored half-formed. Same
            // rule the webhook applies (parseCallPayload is shared).
            if (!row) continue;
            rows.push({
                ...row,
                practice_id: account.practice_id ?? null,
                integration_account_id: account.id,
            });
        }
        const { upserted } = await callrailRepository.upsertCalls(orgId, rows);
        await integrationAccountRepository.markSynced(orgId, account.id);
        return { ingested: upserted, fetched: calls.length, requests, truncated };
    } catch (err) {
        try {
            await integrationAccountRepository.markFailed(orgId, account.id, String(err.message).slice(0, 500));
        } catch (markErr) {
            console.error(`[callrail] account ${account.id} markFailed failed:`, markErr?.message || markErr);
        }
        throw err;
    }
}

// Worker entry: every CallRail company across every org, active or
// self-healing from a prior failure (see file header — never 'active'
// alone). One company failing must not stop the rest, and must not be
// swallowed silently — report it (console + Sentry) and carry on, mirroring
// gohighlevel-sync.js's own syncAllOrgs (the July 2026 incident that pattern
// exists to prevent: a caught-and-swallowed error kept a monitor green while
// several subaccounts failed nightly for over a week).
export async function syncAllOrgs() {
    const accounts = await integrationAccountRepository.listAllSyncable('callrail');
    const results = [];
    for (const account of accounts) {
        try {
            const r = await syncAccount(account.organisation_id, account);
            results.push({ orgId: account.organisation_id, accountId: account.id, ...r });
        } catch (err) {
            Sentry.withScope((scope) => {
                scope.setTag('integration', 'callrail');
                scope.setTag('organisation_id', account.organisation_id);
                scope.setTag('callrail_account_id', account.id);
                scope.setContext('callrail_account', {
                    label: account.label ?? null,
                    external_account_id: account.external_account_id ?? null,
                    previous_status: account.status ?? null,
                    last_sync_at: account.last_sync_at ?? null,
                });
                Sentry.captureException(err);
            });
            console.error(`[callrail] account ${account.id} (${account.label ?? 'unlabelled'}) sync failed: ${err.message}`);
            results.push({ orgId: account.organisation_id, accountId: account.id, error: err.message });
        }
    }
    return results;
}
