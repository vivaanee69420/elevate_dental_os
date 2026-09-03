// Google Ads spend/performance sync — pulls per-campaign, per-day metrics for
// the sync window (nightly 3mo / reconnect backfill 6mo) via GAQL
// (googleAds:searchStream) for each accessible
// customer, converts cost (micros) to integer pence, and replaces the window's
// google_ads rows in ad_metrics. MULTI-TENANT: every row carries
// organisation_id; the loop is per-org and serviceClient queries are filtered
// on organisation_id (same isolation model as quickbooks-sync.js).
//
//   POST {base}/{ver}/customers/{cid}/googleAds:searchStream
//     Authorization: Bearer <access_token>
//     developer-token: <GOOGLE_ADS_DEVELOPER_TOKEN>
//     login-customer-id: <MCC>            (optional, set by adsHeaders)
//     body: { "query": "<GAQL>" }
//   -> [ { results: [ { campaign, segments, metrics } ] }, ... ]   (streamed batches)
//   -> one ad_metrics row per (campaign, date)
//
// cost_micros is account-currency micros: 1 unit = 1,000,000 micros. Pence =
// micros / 10,000 (micros/1e6 currency units * 100 pence). Rule 2: integer pence.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { apiBase, fetchWithApiVersion } from './google-ads-version.js';
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";
import { londonDaysAgo, londonYmd } from "../tz.js";
import { syncGoogleDeep, DEEP_WINDOW_DAYS } from "./google-ads-deep-sync.js";
import { partitionAccountsByCurrency } from "./ad-currency.js";

const INCREMENTAL_DAYS = 90;  // nightly cron window: trailing 3 months (product rule)
const FULL_DAYS = 183;        // on-connect / reconnect backfill window: 6 months (product rule)

// GAQL is built per-window. campaign.status + advertising_channel_type are the
// campaign dimensions (objective proxy); customer.descriptive_name +
// currency_code enrich the account dimension. Google exposes no per-campaign
// unique-reach/frequency at this grain, so those stay null on ad_metrics.
function buildGaql(sinceDate, untilDate) {
    return [
        'SELECT campaign.id, campaign.name, campaign.status,',
        'campaign.advertising_channel_type, segments.date,',
        'customer.descriptive_name, customer.currency_code,',
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions',
        `FROM campaign WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`,
    ].join(' ');
}

function microsToPence(micros) {
    const n = Number(micros ?? 0);
    return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
}

// London-local YYYY-MM-DD `days` ago. Google Ads buckets segments.date by the
// customer account's timezone (Europe/London for UK accounts), so window edges
// must be London days, not UTC.
function daysAgo(days) {
    return londonDaysAgo(days);
}

// searchStream returns an ARRAY of batches, each { results: [...] }. Flatten to
// rows. Field names are camelCase in the JSON (costMicros, not cost_micros).
// Returns { rows, account } — account = { name, currency } sniffed from the
// customer fields on any row (same for every row of one customer).
function parseSearchStream(batches) {
    const out = [];
    let account = null;
    for (const batch of Array.isArray(batches) ? batches : []) {
        for (const r of batch?.results ?? []) {
            const campaign = r.campaign ?? {};
            const segments = r.segments ?? {};
            const metrics = r.metrics ?? {};
            const customer = r.customer ?? {};
            if (!account && (customer.descriptiveName || customer.currencyCode)) {
                account = { name: customer.descriptiveName ?? null, currency: customer.currencyCode ?? null };
            }
            if (!campaign.id || !segments.date) continue;
            out.push({
                campaign_id: String(campaign.id),
                campaign_name: campaign.name ?? null,
                metric_date: segments.date,
                spend_pence: microsToPence(metrics.costMicros),
                impressions: Number(metrics.impressions ?? 0),
                clicks: Number(metrics.clicks ?? 0),
                reach: null,
                frequency: null,
                campaign_status: campaign.status ?? null,
                objective: campaign.advertisingChannelType ?? null,
                conversions: Math.round(Number(metrics.conversions ?? 0)),
            });
        }
    }
    return { rows: out, account };
}

// API base + version: ./google-ads-version.js (self-heals when Google retires a version).

// Ensure a fresh access token (refresh when within 60s of expiry / expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { GoogleAdsProvider } = await import('./google-ads-provider.js');
    await GoogleAdsProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'google_ads');
}

async function queryCustomer(customerId, accessToken, query) {
    const { adsHeaders, googleAdsErrorMessage } = await import('./google-ads-provider.js');
    const res = await fetchWithApiVersion(
        (v) => `${apiBase()}/${v}/customers/${customerId}/googleAds:searchStream`,
        { method: 'POST', headers: adsHeaders(accessToken), body: JSON.stringify({ query }) },
    );
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // googleAdsErrorMessage walks details[].errors[] for the specific code.
        // Reading error.message alone yields Google's generic "Request contains
        // an invalid argument", which is what made a Manager account and a
        // deactivated account indistinguishable from a transient glitch.
        throw new Error(googleAdsErrorMessage(body, res.status, 'searchStream'));
    }
    return res.json();
}

// Two Google error codes mean an account can NEVER serve metrics, no matter how
// often we retry: the login's own Manager (MCC) account, which
// listAccessibleCustomers returns alongside the real ones, and an account that
// has been deactivated. Everything else — throttles, deadlines, 5xx — stays
// retryable, because marking a live account permanent would drop it out of the
// sync silently and for good.
const PERMANENT_CUSTOMER_ERRORS = {
    REQUESTED_METRICS_FOR_MANAGER: 'manager',
    CUSTOMER_NOT_ENABLED: 'not_enabled',
};

export function classifyCustomerError(message) {
    const msg = String(message ?? '');
    for (const [code, status] of Object.entries(PERMANENT_CUSTOMER_ERRORS)) {
        if (msg.includes(code)) return status;
    }
    return null;
}

// The ad_accounts statuses that take a customer out of the nightly pull. A
// successful sync or a reconnect writes status back to null (upsertAdAccounts
// sets it from the payload), so this self-heals the moment the account works
// again — a reactivated Google Ads account recovers on the next connect.
//
// EXPORTED so the reconciliation service can derive the same "this account is
// not in the pull" set from one definition. Two copies of this list would
// drift, and a drifted copy shows up as a permanent unexplained spend gap on
// the tally screen.
export const SKIP_STATUSES = new Set(Object.values(PERMANENT_CUSTOMER_ERRORS));

export async function syncOneOrg(orgId, integrationArg, _onProgress, opts = {}) {
    let integration = integrationArg ?? await integrationRepository.getByProvider(orgId, 'google_ads');
    if (!integration?.secrets) {
        await integrationRepository.markFailed(orgId, 'google_ads', 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        integration = await ensureToken(orgId, integration);
        const allCustomerIds = integration.config?.customer_ids ?? [];
        if (allCustomerIds.length === 0) {
            throw new Error('no accessible Google Ads customers (check developer token / MCC access)');
        }
        // Drop accounts already known to be permanently unusable so the nightly
        // run stops spending a doomed request on each of them forever.
        let permanent = new Set();
        try {
            const known = await integrationRepository.listAdAccounts(orgId, 'google_ads');
            permanent = new Set((known ?? [])
                .filter((a) => SKIP_STATUSES.has(a.status))
                .map((a) => String(a.customer_id)));
        } catch (err) {
            // Non-fatal: without the skip list we simply query everything, which
            // is the old behaviour. Never let it block a real sync.
            console.error('[google_ads] ad_accounts skip-list read failed:', err.message);
        }
        const customerIds = allCustomerIds.filter((cid) => !permanent.has(String(cid)));
        if (customerIds.length === 0) {
            throw new Error(`no usable Google Ads customers — all ${allCustomerIds.length} are manager or deactivated accounts`);
        }
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        // Full backfill pulls 6mo; the nightly cron pulls the trailing 3mo.
        const windowDays = opts.full ? FULL_DAYS : INCREMENTAL_DAYS;
        const sinceDate = daysAgo(windowDays);
        const untilDate = londonYmd();
        const gaql = buildGaql(sinceDate, untilDate);

        // Pull each accessible account; skip the ones that error (a Manager
        // account, or one the dev token can't reach) so one bad account doesn't
        // sink the whole sync. Enrich the account dimension from the customer
        // fields returned on each stream.
        const all = [];
        const skipped = [];
        const accounts = [];
        for (const cid of customerIds) {
            try {
                const batches = await queryCustomer(cid, access_token, gaql);
                const { rows, account } = parseSearchStream(batches);
                accounts.push({ customer_id: cid, name: account?.name ?? null, currency: account?.currency ?? null });
                for (const row of rows) {
                    all.push({ organisation_id: orgId, practice_id: null, provider: 'google_ads', source: 'google_ads', customer_id: cid, ...row });
                }
            } catch (err) {
                const msg = String(err.message).slice(0, 200);
                skipped.push({ cid, error: msg });
                // Permanent failure: record it so tomorrow's run skips this
                // account outright instead of repeating the same doomed call.
                const permanentStatus = classifyCustomerError(msg);
                if (permanentStatus) {
                    try {
                        await integrationRepository.markAdAccountStatus(orgId, 'google_ads', cid, permanentStatus);
                    } catch (e) {
                        console.error('[google_ads] mark %s as %s failed: %s', cid, permanentStatus, e.message);
                    }
                }
            }
        }
        // Refresh account names/currency for the selector (non-fatal).
        try {
            if (accounts.length) await integrationRepository.upsertAdAccounts(orgId, 'google_ads', accounts);
        } catch (err) {
            console.error('[google_ads] sync ad_accounts refresh failed:', err.message);
        }

        // Robustness: if EVERY customer query failed (e.g. a revoked/expired
        // token), the pull returned nothing because of errors, not because there
        // was no spend. Do NOT wipe the existing window and report healthy —
        // mark failed and surface the error so the nightly retry + UI see it.
        const allErrored = customerIds.length > 0 && skipped.length === customerIds.length;
        if (allErrored) {
            const msg = `all accounts failed: ${skipped.map((s) => s.error).join('; ')}`.slice(0, 500);
            await integrationRepository.markFailed(orgId, 'google_ads', msg);
            throw new Error(msg);
        }

        // Replace the window ONLY for customers that actually returned rows. An
        // account that errored — OR returned an empty 200 (a transient glitch:
        // report not ready, throttle, momentary access loss) — keeps its existing
        // rows. Daily spend is immutable history, so the only safe trigger for a
        // destructive delete is a non-empty pull. Scoped to (provider, those
        // customers) so other channels (meta_ads) are never clobbered.
        const cidsWithRows = [...new Set(all.map((r) => r.customer_id))];
        const since = sinceDate;
        // Atomic, serialized replace: delete-window + upsert in ONE transaction
        // guarded by a per-(org, provider) advisory lock (RPC). Upsert (not plain
        // insert) so a boundary/timezone-skew row dated before the window updates
        // in place instead of erroring on the unique key. Doing the delete and
        // the writes in a single locked transaction prevents a 6-month backfill
        // and the nightly incremental from deadlocking on ad_metrics row locks,
        // which surfaced as "ad_metrics upsert: canceling statement due to
        // statement timeout" when the two syncs overlapped.
        if (cidsWithRows.length > 0) {
            const { error } = await supabase_1.serviceClient.rpc('ad_metrics_replace_window', {
                p_org: orgId,
                p_provider: 'google_ads',
                p_customer_ids: cidsWithRows,
                p_since: since,
                p_rows: all,
            });
            if (error) throw new Error(`ad_metrics upsert: ${error.message}`);
        }

        // Deep grain (ad group / ad / keyword) runs AFTER the campaign replace
        // and is wrapped so it can never fail the campaign sync. Campaign grain
        // feeds every existing marketing figure; deep grain feeds two new pages
        // that tolerate being a day stale. A keyword pull that trips a 403
        // throttle must not cost us the day's spend.
        let deep = { counts: {}, skipped: [], unsupportedCurrency: [] };
        try {
            // Currency comes from the LIVE stream we just read (customer
            // .currency_code, sniffed into `accounts` above), not from a
            // re-read of ad_accounts. The old re-read was wrapped in
            // `.catch(() => [])`, so a database hiccup made every currency
            // read null — and a null currency is treated as GBP by design.
            // The guard therefore FAILED OPEN on exactly the kind of transient
            // fault it is meant to survive, admitting a USD account and
            // silently inflating every group total. The stream value is also
            // fresher: it is this run's answer from Google, not the last
            // sync's copy.
            const byId = new Map(accounts.map((a) => [String(a.customer_id), a]));
            const { supported, unsupported } = partitionAccountsByCurrency(
                cidsWithRows.map((cid) => ({ customer_id: cid, currency: byId.get(String(cid))?.currency ?? null })),
            );
            const deepSince = daysAgo(DEEP_WINDOW_DAYS);
            const r = await syncGoogleDeep(orgId, {
                accessToken: access_token,
                customerIds: supported,
                since: deepSince,
                until: untilDate,
                queryCustomer: (cid, tok, gaql) => queryCustomer(cid, tok, gaql),
            });
            deep = { ...r, unsupportedCurrency: unsupported };
        } catch (err) {
            console.error('[google_ads] deep-grain sync failed:', err.message);
            deep = { counts: {}, skipped: [], unsupportedCurrency: [], error: String(err.message).slice(0, 200) };
        }

        // Scoped status write (won't resurrect a row revoked mid-sync).
        await integrationRepository.markSynced(orgId, 'google_ads');
        return { rows: all.length, customers: customerIds.length, skipped, permanentlySkipped: [...permanent], deep };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'google_ads', String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllOrgs() {
    // Include 'failed' alongside 'active' so a transient failure self-heals on
    // the next nightly run instead of being skipped forever. 'revoked' (the user
    // disconnected) is intentionally excluded.
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'google_ads')
        .in('status', ['active', 'failed']);
    const results = [];
    for (const row of rows ?? []) {
        try {
            const r = await syncOneOrg(row.organisation_id, row);
            results.push({ orgId: row.organisation_id, ...r });
        } catch (err) {
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

export const __test = { microsToPence, parseSearchStream, buildGaql, classifyCustomerError, INCREMENTAL_DAYS, FULL_DAYS };
