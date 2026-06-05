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

const GAQL = [
    'SELECT campaign.id, campaign.name, segments.date,',
    'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions',
    'FROM campaign WHERE segments.date DURING LAST_30_DAYS',
].join(' ');

function microsToPence(micros) {
    const n = Number(micros ?? 0);
    return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
}

// searchStream returns an ARRAY of batches, each { results: [...] }. Flatten to
// rows. Field names are camelCase in the JSON (costMicros, not cost_micros).
function parseSearchStream(batches) {
    const out = [];
    for (const batch of Array.isArray(batches) ? batches : []) {
        for (const r of batch?.results ?? []) {
            const campaign = r.campaign ?? {};
            const segments = r.segments ?? {};
            const metrics = r.metrics ?? {};
            if (!campaign.id || !segments.date) continue;
            out.push({
                campaign_id: String(campaign.id),
                campaign_name: campaign.name ?? null,
                metric_date: segments.date,
                spend_pence: microsToPence(metrics.costMicros),
                impressions: Number(metrics.impressions ?? 0),
                clicks: Number(metrics.clicks ?? 0),
                conversions: Math.round(Number(metrics.conversions ?? 0)),
            });
        }
    }
    return out;
}

function apiBase() {
    return process.env.GOOGLE_ADS_API_BASE || 'https://googleads.googleapis.com';
}
function apiVersion() {
    return process.env.GOOGLE_ADS_API_VERSION || 'v17';
}

// Ensure a fresh access token (refresh when within 60s of expiry / expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { GoogleAdsProvider } = await import('./google-ads-provider.js');
    await GoogleAdsProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'google_ads');
}

async function queryCustomer(customerId, accessToken) {
    const { adsHeaders } = await import('./google-ads-provider.js');
    const url = `${apiBase()}/${apiVersion()}/customers/${customerId}/googleAds:searchStream`;
    const res = await fetch(url, {
        method: 'POST',
        headers: adsHeaders(accessToken),
        body: JSON.stringify({ query: GAQL }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `searchStream HTTP ${res.status}`);
    }
    return res.json();
}

export async function syncOneOrg(orgId, integrationArg, _onProgress, _opts) {
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

        // Pull each accessible account; skip the ones that error (a Manager
        // account, or one the dev token can't reach) so one bad account doesn't
        // sink the whole sync.
        const all = [];
        const skipped = [];
        for (const cid of customerIds) {
            try {
                const batches = await queryCustomer(cid, access_token);
                for (const row of parseSearchStream(batches)) {
                    all.push({ organisation_id: orgId, practice_id: null, provider: 'google_ads', source: 'google_ads', customer_id: cid, ...row });
                }
            } catch (err) {
                skipped.push({ cid, error: String(err.message).slice(0, 200) });
            }
        }

        // Replace the whole window: delete this org's google_ads rows in the
        // last-30-day range, then insert fresh. Idempotent; filtered on provider
        // so other channels (meta_ads) for the same dates are never clobbered.
        const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10);
        const { error: delErr } = await supabase_1.serviceClient
            .from('ad_metrics')
            .delete()
            .eq('organisation_id', orgId)
            .eq('provider', 'google_ads')
            .gte('metric_date', since);
        if (delErr) throw new Error(`ad_metrics clear: ${delErr.message}`);
        if (all.length > 0) {
            const { error } = await supabase_1.serviceClient.from('ad_metrics').insert(all);
            if (error) throw new Error(`ad_metrics insert: ${error.message}`);
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

export const __test = { microsToPence, parseSearchStream, GAQL };
