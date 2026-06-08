// Meta (Facebook) Ads spend/performance sync — pulls per-campaign, per-day
// insights for the last 30 days via the Graph API for each connected ad
// account, converts spend (account-currency decimal string) to integer pence,
// and replaces the window's meta_ads rows in ad_metrics. MULTI-TENANT: every
// row carries organisation_id; the loop is per-org and serviceClient queries
// are filtered on organisation_id (same isolation model as google-ads-sync.js).
//
//   GET {graph}/{ver}/act_{accountId}/insights
//       ?level=campaign&time_increment=1&date_preset=last_30d
//       &fields=campaign_id,campaign_name,spend,impressions,clicks,actions
//       &access_token=<long-lived>
//   -> { data: [ { campaign_id, campaign_name, date_start, spend, actions } ], paging }
//   -> one ad_metrics row per (campaign, date)
//
// Unlike Google (cost in micros), Meta returns spend as account-currency MAJOR
// units in a STRING ("12.34"). Pence = round(parseFloat(spend) * 100). Rule 2:
// integer pence. Conversions are summed from the `actions` breakdown.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const INSIGHT_FIELDS = 'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency,actions';
// Incremental window (daily cron); a full backfill pulls 12 months.
const INCREMENTAL_DAYS = 31;
const FULL_DAYS = 366;
// action_types that count as a conversion for a dental practice (form leads,
// pixel leads, purchases, registrations, appointment schedules, contacts).
const CONVERSION_ACTION = /lead|purchase|complete_registration|schedule|contact|submit_application/i;

function spendToPence(spend) {
    const n = parseFloat(spend);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Sum the value of every action whose type looks like a conversion. Meta's
// `actions` is an array of { action_type, value } where value is a string.
function conversionsFromActions(actions) {
    if (!Array.isArray(actions)) return 0;
    let total = 0;
    for (const a of actions) {
        if (a && CONVERSION_ACTION.test(String(a.action_type ?? ''))) {
            const v = Number(a.value ?? 0);
            if (Number.isFinite(v)) total += v;
        }
    }
    return Math.round(total);
}

// Flatten insight rows to ad_metrics shape; drop rows missing campaign/date.
// `campaignMeta` maps campaign_id -> { status, objective } (from the campaigns
// edge, which insights doesn't carry).
function parseInsights(rows, campaignMeta = {}) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r?.campaign_id || !r?.date_start) continue;
        const cid = String(r.campaign_id);
        const meta = campaignMeta[cid] ?? {};
        const freq = Number(r.frequency);
        out.push({
            campaign_id: cid,
            campaign_name: r.campaign_name ?? null,
            metric_date: r.date_start,
            spend_pence: spendToPence(r.spend),
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            reach: Number(r.reach ?? 0),
            frequency: Number.isFinite(freq) ? freq : null,
            campaign_status: meta.status ?? null,
            objective: meta.objective ?? null,
            conversions: conversionsFromActions(r.actions),
        });
    }
    return out;
}

function graphBase() {
    return process.env.META_GRAPH_BASE || 'https://graph.facebook.com';
}
function apiVersion() {
    return process.env.META_API_VERSION || 'v21.0';
}

// Meta long-lived tokens last ~60 days. Roll the window forward when within 7
// days of expiry (or already expired). fb_exchange_token only re-issues if the
// token is >24h old, so a daily call is harmless.
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (!expiresAt || expiresAt - Date.now() > 7 * 86400_000) return integration;
    const { MetaAdsProvider } = await import('./meta-ads-provider.js');
    await MetaAdsProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'meta_ads');
}

// ISO YYYY-MM-DD `days` ago (UTC).
function daysAgo(days) {
    return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

async function queryAccount(accountId, accessToken, sinceDate) {
    const until = new Date().toISOString().slice(0, 10);
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceDate, until }));
    let url = `${graphBase()}/${apiVersion()}/act_${accountId}/insights`
        + `?level=campaign&time_increment=1&time_range=${timeRange}`
        + `&fields=${INSIGHT_FIELDS}&limit=500&access_token=${encodeURIComponent(accessToken)}`;
    const rows = [];
    let guard = 0;
    // paging.next is a full URL with the access_token already embedded.
    while (url && guard < 200) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message || `insights HTTP ${res.status}`);
        for (const r of body.data ?? []) rows.push(r);
        url = body.paging?.next || null;
        guard++;
    }
    return rows;
}

// Campaign-level dimensions (status, objective) — not available on insights.
// Returns { campaign_id: { status, objective } }; a failure here is non-fatal
// (dims are nullable), so the caller swallows the error.
async function fetchCampaignMeta(accountId, accessToken) {
    let url = `${graphBase()}/${apiVersion()}/act_${accountId}/campaigns`
        + `?fields=id,status,objective&limit=500&access_token=${encodeURIComponent(accessToken)}`;
    const map = {};
    let guard = 0;
    while (url && guard < 50) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error?.message || `campaigns HTTP ${res.status}`);
        for (const c of body.data ?? []) {
            if (c.id) map[String(c.id)] = { status: c.status ?? null, objective: c.objective ?? null };
        }
        url = body.paging?.next || null;
        guard++;
    }
    return map;
}

export async function syncOneOrg(orgId, integrationArg, _onProgress, opts = {}) {
    let integration = integrationArg ?? await integrationRepository.getByProvider(orgId, 'meta_ads');
    if (!integration?.secrets) {
        await integrationRepository.markFailed(orgId, 'meta_ads', 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        integration = await ensureToken(orgId, integration);
        const accountIds = integration.config?.account_ids ?? [];
        if (accountIds.length === 0) {
            throw new Error('no connected Meta ad accounts (check ads_read permission)');
        }
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        // Full backfill (post-connect / manual Refresh ?full=true) pulls 12mo;
        // the nightly cron pulls the rolling ~30-day window.
        const windowDays = opts.full ? FULL_DAYS : INCREMENTAL_DAYS;
        const sinceDate = daysAgo(windowDays);

        // Refresh the account dimension (names/currency/status) for the selector;
        // non-fatal — selection still works off the ids stored at connect.
        try {
            const { listAdAccounts } = await import('./meta-ads-provider.js');
            const accounts = await listAdAccounts(access_token);
            if (accounts.length) await integrationRepository.upsertAdAccounts(orgId, 'meta_ads', accounts);
        } catch (err) {
            console.error('[meta_ads] sync ad_accounts refresh failed:', err.message);
        }

        // Pull each ad account; skip the ones that error (a disabled account, or
        // one the user lost access to) so one bad account doesn't sink the sync.
        const all = [];
        const skipped = [];
        for (const aid of accountIds) {
            try {
                const meta = await fetchCampaignMeta(aid, access_token).catch(() => ({}));
                const rows = await queryAccount(aid, access_token, sinceDate);
                for (const row of parseInsights(rows, meta)) {
                    all.push({ organisation_id: orgId, practice_id: null, provider: 'meta_ads', source: 'meta_ads', customer_id: aid, ...row });
                }
            } catch (err) {
                skipped.push({ aid, error: String(err.message).slice(0, 200) });
            }
        }

        // Replace the whole window: delete this org's meta_ads rows in the pulled
        // range, then insert fresh. Idempotent; filtered on provider so other
        // channels (google_ads) for the same dates are never clobbered.
        const since = sinceDate;
        const { error: delErr } = await supabase_1.serviceClient
            .from('ad_metrics')
            .delete()
            .eq('organisation_id', orgId)
            .eq('provider', 'meta_ads')
            .gte('metric_date', since);
        if (delErr) throw new Error(`ad_metrics clear: ${delErr.message}`);
        if (all.length > 0) {
            const { error } = await supabase_1.serviceClient.from('ad_metrics').insert(all);
            if (error) throw new Error(`ad_metrics insert: ${error.message}`);
        }

        await integrationRepository.upsert(orgId, 'meta_ads', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { rows: all.length, accounts: accountIds.length, skipped };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'meta_ads', String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'meta_ads')
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

export const __test = { spendToPence, conversionsFromActions, parseInsights, INSIGHT_FIELDS };
