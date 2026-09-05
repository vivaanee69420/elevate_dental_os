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
import { syncGoogleDeep, DEEP_WINDOW_DAYS, CAMPAIGN_SHARE_METRICS } from "./google-ads-deep-sync.js";
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
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions,',
        // Value, not just count — a campaign producing ten £40 enquiries and
        // one producing ten £4,000 implant consultations are otherwise
        // indistinguishable. all_conversions and phone_calls carry the actions
        // Google keeps OUT of the headline figure, call-extension calls
        // included, which for a dental practice is most of the point.
        'metrics.conversions_value, metrics.all_conversions, metrics.phone_calls,',
        // All FIVE impression-share ratios — campaign is the only grain that
        // accepts the budget-lost one (a budget is a campaign-level object).
        // The list is imported, never re-typed here: a second copy of it in
        // this file is precisely what left the ad-group pull degraded for a
        // day. See the measured support table in google-ads-deep-sync.js.
        //
        // Null on campaign types that do not compete in the search auction
        // (Display, Video), which is correct and must stay null, never 0.
        CAMPAIGN_SHARE_METRICS,
        `FROM campaign WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`,
    ].join(' ');
}

// The shape this query had before the enrichment above, used ONLY as a
// fallback. GAQL rejects an unknown or incompatible field by failing the whole
// query rather than omitting the column, and this is the campaign tier — the
// single most load-bearing read in the marketing stack, behind every spend
// figure in the app. Losing it to one retired field name is not an acceptable
// risk to run for the sake of five ratios, so a failure degrades to the
// working shape and reports the downgrade rather than taking the tier down.
function buildBasicGaql(sinceDate, untilDate) {
    return [
        'SELECT campaign.id, campaign.name, campaign.status,',
        'campaign.advertising_channel_type, segments.date,',
        'customer.descriptive_name, customer.currency_code,',
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions',
        `FROM campaign WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'`,
    ].join(' ');
}

// Account-currency units -> integer pence (rule 2). Distinct from
// microsToPence: cost arrives in micros, conversion value in whole units.
// Null, never 0, when Google reports nothing — a campaign we cannot price is
// not a campaign worth nothing.
function moneyToPence(value) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// An impression-share ratio, 0..1, or null where Google reported none. NEVER
// 0: ad_google_campaign_rollup filters its weighted-average denominator on
// exactly this nullness, and a 0 would drag every reported share downward.
function ratioOrNull(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function countOrNull(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
                // FRACTIONAL, never rounded — Google reports modelled
                // conversions as decimals (3.5 is a real value in its own
                // interface). ad_metrics.conversions is numeric(14,2)
                // (migration 000157); rounding here would silently drift
                // this campaign tier's own tracked figure away from the
                // ad-group/ad/keyword deep-grain tiers, which already store
                // it exact (google-ads-deep-sync.js's `conversions()`).
                conversions: Number(metrics.conversions ?? 0),
                conversions_value_pence: moneyToPence(metrics.conversionsValue),
                all_conversions: countOrNull(metrics.allConversions),
                phone_calls: countOrNull(metrics.phoneCalls),
                search_impression_share: ratioOrNull(metrics.searchImpressionShare),
                search_top_impression_share: ratioOrNull(metrics.searchTopImpressionShare),
                search_absolute_top_impression_share: ratioOrNull(metrics.searchAbsoluteTopImpressionShare),
                search_budget_lost_impression_share: ratioOrNull(metrics.searchBudgetLostImpressionShare),
                search_rank_lost_impression_share: ratioOrNull(metrics.searchRankLostImpressionShare),
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

async function queryCustomer(customerId, accessToken, query, loginCustomerId = null) {
    const { adsHeaders, googleAdsErrorMessage } = await import('./google-ads-provider.js');
    const res = await fetchWithApiVersion(
        (v) => `${apiBase()}/${v}/customers/${customerId}/googleAds:searchStream`,
        {
            method: 'POST',
            // An account reached through a manager MUST carry that manager as
            // login-customer-id; without it Google answers as though the account
            // does not exist for this credential.
            headers: adsHeaders(accessToken, { loginCustomerId }),
            body: JSON.stringify({ query }),
        },
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
        let allCustomerIds = integration.config?.customer_ids ?? [];
        let customerLogins = integration.config?.customer_logins ?? {};
        if (allCustomerIds.length === 0) {
            throw new Error('no accessible Google Ads customers (check developer token / MCC access)');
        }
        // Drop accounts already known to be permanently unusable so the nightly
        // run stops spending a doomed request on each of them forever.
        let knownAccounts = [];
        let permanent = new Set();
        // A manager is permanently unusable for METRICS and simultaneously the
        // only route to its client accounts, so it is tracked separately: never
        // queried for spend, always probed for hierarchy. Collapsing the two
        // ideas into one skip set is what made the first cut of this fix inert
        // — it excluded the MCC from the probe and so never found the children
        // sitting underneath it.
        let managerIds = new Set();
        try {
            knownAccounts = await integrationRepository.listAdAccounts(orgId, 'google_ads') ?? [];
            const known = knownAccounts;
            permanent = new Set((known ?? [])
                .filter((a) => SKIP_STATUSES.has(a.status))
                .map((a) => String(a.customer_id)));
            managerIds = new Set((known ?? [])
                .filter((a) => a.status === PERMANENT_CUSTOMER_ERRORS.REQUESTED_METRICS_FOR_MANAGER)
                .map((a) => String(a.customer_id)));
        } catch (err) {
            // Non-fatal: without the skip list we simply query everything, which
            // is the old behaviour. Never let it block a real sync.
            console.error('[google_ads] ad_accounts skip-list read failed:', err.message);
        }
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));

        // Re-resolve the account hierarchy on EVERY run, not only at connect.
        // Account access moves — a practice's account gets relinked under a
        // manager, listAccessibleCustomers stops naming it, and the sync keeps
        // reporting healthy off whichever accounts are still linked directly.
        // That is how Ashford and Barnet went six weeks with no data while the
        // integration showed `active`. Re-resolving here means the next nightly
        // run repairs it with no reconnect asked of the owner.
        //
        // This runs BEFORE the skip filter and AFTER the skip list is read, on
        // purpose: the newly resolved ids must reach the pull loop below, and
        // accounts already known permanently unusable must not cost a probe.
        // Non-fatal — on failure we fall back to the stored set, which is the
        // old behaviour.
        try {
            const { expandManagerAccounts, listAccessibleCustomers } = await import('./google-ads-provider.js');
            const seed = await listAccessibleCustomers(access_token).catch(() => allCustomerIds);
            // Unprobeable = permanently unusable AND not a manager. A
            // deactivated account can serve nothing, hierarchy included; a
            // manager serves the hierarchy and nothing else.
            const unprobeable = new Set([...permanent].filter((cid) => !managerIds.has(String(cid))));
            const expanded = await expandManagerAccounts(
                access_token,
                (seed?.length ? seed : allCustomerIds).filter((cid) => !unprobeable.has(String(cid))),
                { skip: unprobeable },
            );
            // Take the expansion's set outright rather than unioning it with the
            // stored one. It already keeps every direct grant it could not
            // disprove, and drops the ids it confirmed are managers — union them
            // back in and every manager buys a guaranteed failed metrics call
            // per night, which is the cost the skip list exists to avoid. An
            // empty result means the expansion learned nothing, and the stored
            // set stands.
            const resolved = expanded.customerIds.length ? expanded.customerIds : allCustomerIds.map(String);
            const stored = allCustomerIds.map(String);
            const added = resolved.filter((c) => !stored.includes(String(c)));
            const removed = stored.filter((c) => !resolved.includes(String(c)));
            // Write only on a real change — an unconditional merge would burn a
            // config write per org per night to store an identical object.
            const changed = added.length > 0 || removed.length > 0
                || JSON.stringify(customerLogins) !== JSON.stringify(expanded.loginByCustomer);
            if (changed) {
                allCustomerIds = resolved;
                customerLogins = expanded.loginByCustomer;
                await integrationRepository.mergeConfig(orgId, 'google_ads', {
                    customer_ids: allCustomerIds,
                    customer_logins: customerLogins,
                });
                if (added.length) {
                    console.log('[google_ads] resolved %d account(s) reachable only through a manager: %s',
                        added.length, added.join(', '));
                }
            }
        } catch (err) {
            console.error('[google_ads] account re-resolution failed, using stored set:', err.message);
        }

        const customerIds = allCustomerIds.filter((cid) => !permanent.has(String(cid)));
        if (customerIds.length === 0) {
            throw new Error(`no usable Google Ads customers — all ${allCustomerIds.length} are manager or deactivated accounts`);
        }

        // Full backfill pulls 6mo; the nightly cron pulls the trailing 3mo.
        const windowDays = opts.full ? FULL_DAYS : INCREMENTAL_DAYS;
        const sinceDate = daysAgo(windowDays);
        const untilDate = londonYmd();
        const gaql = buildGaql(sinceDate, untilDate);
        const basicGaql = buildBasicGaql(sinceDate, untilDate);

        // Pull each accessible account; skip the ones that error (a Manager
        // account, or one the dev token can't reach) so one bad account doesn't
        // sink the whole sync. Enrich the account dimension from the customer
        // fields returned on each stream.
        const all = [];
        const skipped = [];
        const accounts = [];
        for (const cid of customerIds) {
            try {
                let batches;
                try {
                    batches = await queryCustomer(cid, access_token, gaql, customerLogins[cid] ?? null);
                } catch (err) {
                    // Degrade, do not disappear — see buildBasicGaql. Reported
                    // in `skipped` so a downgrade that lasts is visible rather
                    // than being mistaken for a working sync.
                    batches = await queryCustomer(cid, access_token, basicGaql, customerLogins[cid] ?? null);
                    skipped.push({
                        cid,
                        error: `enriched query failed, fell back to base fields: ${String(err.message).slice(0, 150)}`,
                    });
                }
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
                queryCustomer: (cid, tok, gaql) => queryCustomer(cid, tok, gaql, customerLogins[cid] ?? null),
            });
            deep = { ...r, unsupportedCurrency: unsupported };
        } catch (err) {
            console.error('[google_ads] deep-grain sync failed:', err.message);
            deep = { counts: {}, skipped: [], unsupportedCurrency: [], error: String(err.message).slice(0, 200) };
        }

        // A sync that pulled SOME of what it should have is not a healthy sync,
        // and until now it was recorded as one. Three ways a pull comes back
        // short, all of them previously silent:
        //
        //  1. A practice-mapped account is not in the pull set at all. This is
        //     the one that cost six weeks: an account relinked under a manager
        //     stops appearing in listAccessibleCustomers, so the sync does not
        //     fail on it — it never asks for it. Nothing errors. The practice
        //     simply reports nothing while the integration shows green.
        //  2. An account errored this run (throttle, transient permission).
        //  3. The deep-grain pull failed. It is wrapped so it can never fail
        //     the campaign sync, which is right, but "cannot fail the sync" was
        //     being read as "need not be mentioned".
        //
        // Recorded as a warning on an otherwise 'active' integration: the
        // connection genuinely works, so flipping it to 'failed' would be a lie
        // in the other direction, and would put a reconnect prompt in front of
        // an owner whose credentials are fine.
        const unreachable = knownAccounts.filter((a) => a.practice_id
            && !permanent.has(String(a.customer_id))
            && !customerIds.map(String).includes(String(a.customer_id)));
        const warnings = [];
        if (unreachable.length) {
            warnings.push(`${unreachable.length} mapped account(s) not reachable by this login: ${unreachable.map((a) => a.name || a.customer_id).join(', ')} — reconnect with a Google account that can see them, or link them under a manager it can.`);
        }
        if (skipped.length) {
            warnings.push(`${skipped.length} account(s) failed this run: ${skipped.map((s) => `${s.cid}: ${s.error}`).join('; ')}`);
        }
        if (deep.error) warnings.push(`deep-grain (ad group/ad/keyword) pull failed: ${deep.error}`);

        // Scoped status write (won't resurrect a row revoked mid-sync).
        await integrationRepository.markSynced(orgId, 'google_ads',
            warnings.length ? warnings.join(' | ').slice(0, 500) : null);
        return { rows: all.length, customers: customerIds.length, skipped, unreachable: unreachable.map((a) => a.customer_id), permanentlySkipped: [...permanent], deep };
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
