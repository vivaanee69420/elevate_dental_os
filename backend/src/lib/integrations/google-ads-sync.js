// Google Ads spend/performance sync — pulls per-campaign, per-day metrics for
// the last 30 days via GAQL (googleAds:searchStream) for each accessible
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
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";
import { londonDaysAgo, londonYmd } from "../tz.js";

const INCREMENTAL_DAYS = 31;
const FULL_DAYS = 366;

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

function apiBase() {
    return process.env.GOOGLE_ADS_API_BASE || 'https://googleads.googleapis.com';
}
function apiVersion() {
    // Must track a currently-supported Google Ads API version (see provider).
    return process.env.GOOGLE_ADS_API_VERSION || 'v20';
}

// Ensure a fresh access token (refresh when within 60s of expiry / expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { GoogleAdsProvider } = await import('./google-ads-provider.js');
    await GoogleAdsProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'google_ads');
}

async function queryCustomer(customerId, accessToken, query) {
    const { adsHeaders } = await import('./google-ads-provider.js');
    const url = `${apiBase()}/${apiVersion()}/customers/${customerId}/googleAds:searchStream`;
    const res = await fetch(url, {
        method: 'POST',
        headers: adsHeaders(accessToken),
        body: JSON.stringify({ query }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `searchStream HTTP ${res.status}`);
    }
    return res.json();
}

export async function syncOneOrg(orgId, integrationArg, _onProgress, opts = {}) {
    let integration = integrationArg ?? await integrationRepository.getByProvider(orgId, 'google_ads');
    if (!integration?.secrets) {
        await integrationRepository.markFailed(orgId, 'google_ads', 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        integration = await ensureToken(orgId, integration);
        const customerIds = integration.config?.customer_ids ?? [];
        if (customerIds.length === 0) {
            throw new Error('no accessible Google Ads customers (check developer token / MCC access)');
        }
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        // Full backfill pulls 12mo; the nightly cron pulls the rolling window.
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
                skipped.push({ cid, error: String(err.message).slice(0, 200) });
            }
        }
        // Refresh account names/currency for the selector (non-fatal).
        try {
            if (accounts.length) await integrationRepository.upsertAdAccounts(orgId, 'google_ads', accounts);
        } catch (err) {
            console.error('[google_ads] sync ad_accounts refresh failed:', err.message);
        }

        // Replace the whole window: delete this org's google_ads rows in the
        // pulled range, then insert fresh. Idempotent; filtered on provider so
        // other channels (meta_ads) for the same dates are never clobbered.
        const since = sinceDate;
        const { error: delErr } = await supabase_1.serviceClient
            .from('ad_metrics')
            .delete()
            .eq('organisation_id', orgId)
            .eq('provider', 'google_ads')
            .gte('metric_date', since);
        if (delErr) throw new Error(`ad_metrics clear: ${delErr.message}`);
        if (all.length > 0) {
            // upsert (not insert) so a boundary/timezone-skew row dated before the
            // delete window updates in place instead of erroring on the unique key.
            const { error } = await supabase_1.serviceClient.from('ad_metrics')
                .upsert(all, { onConflict: 'organisation_id,provider,customer_id,campaign_id,metric_date' });
            if (error) throw new Error(`ad_metrics upsert: ${error.message}`);
        }

        await integrationRepository.upsert(orgId, 'google_ads', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { rows: all.length, customers: customerIds.length, skipped };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'google_ads', String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'google_ads')
        .eq('status', 'active');
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

export const __test = { microsToPence, parseSearchStream, buildGaql };
