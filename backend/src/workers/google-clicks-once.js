// ============================================================================
// One-shot click_view backfill.
//
// The nightly Google sync already does this — google-ads-sync.js runs
// syncGoogleClicks behind the spend pull, and an empty google_clicks table
// makes the first run a full 90-day walk on its own. This script exists for
// the one case where waiting is the wrong answer: the day the feature ships.
//
// EVERY DAY OF DELAY IS A DAY LOST FOR GOOD. click_view retains 90 days, so
// the window this recovers shrinks by one day for every day it is not run,
// and nothing built later gets those days back.
//
//   node src/workers/google-clicks-once.js [orgId]
//
// With no orgId it walks every org holding an active/failed google_ads
// integration, the same set syncAllOrgs uses. Read-only against Google;
// the only write is an ON CONFLICT DO NOTHING insert into google_clicks, so
// re-running it is free and safe.
// ============================================================================
import 'dotenv/config';
import * as supabase_1 from "../lib/supabase.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { decryptSecret } from "../lib/crypto.js";
import { adsHeaders, googleAdsErrorMessage, GoogleAdsProvider } from "../lib/integrations/google-ads-provider.js";
import { fetchWithApiVersion, apiBase } from "../lib/integrations/google-ads-version.js";
import { syncGoogleClicks, SKIP_ACCOUNT_STATUSES } from "../lib/integrations/google-ads-clicks-sync.js";
import { londonYmd } from "../lib/tz.js";

async function queryCustomer(customerId, accessToken, query, loginCustomerId = null) {
    const res = await fetchWithApiVersion(
        (v) => `${apiBase()}/${v}/customers/${customerId}/googleAds:searchStream`,
        {
            method: 'POST',
            headers: adsHeaders(accessToken, { loginCustomerId }),
            body: JSON.stringify({ query }),
        },
    );
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(googleAdsErrorMessage(body, res.status, 'clickView'));
    }
    return res.json();
}

async function runOrg(orgId) {
    let integration = await integrationRepository.getByProvider(orgId, 'google_ads');
    if (!integration?.secrets) {
        console.log(`[clicks] ${orgId}: no google_ads credentials, skipping`);
        return;
    }
    // Refresh if the token is expired or nearly so — a 90-day walk outlives a
    // token minted at the start of it, but the provider refreshes on 401 and
    // this only has to be fresh enough to begin.
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (!expiresAt || expiresAt - Date.now() < 60_000) {
        await GoogleAdsProvider.refresh(orgId);
        integration = await integrationRepository.getByProvider(orgId, 'google_ads');
    }
    const { access_token } = JSON.parse(decryptSecret(integration.secrets));
    const logins = integration.config?.customer_logins ?? {};

    // Accounts known permanently unusable are excluded. At one query per day
    // per account, including a manager or a deactivated account would spend 90
    // doomed requests on each of them.
    const accounts = await integrationRepository.listAdAccounts(orgId, 'google_ads') ?? [];
    const customerIds = accounts
        .filter((a) => !SKIP_ACCOUNT_STATUSES.has(a.status))
        .map((a) => String(a.customer_id));

    console.log(`[clicks] ${orgId}: ${customerIds.length} account(s) of ${accounts.length}`);
    const r = await syncGoogleClicks(orgId, {
        accessToken: access_token,
        customerIds,
        until: londonYmd(),
        queryCustomer: (cid, tok, gaql) => queryCustomer(cid, tok, gaql, logins[cid] ?? null),
    });
    console.log(`[clicks] ${orgId}: ${r.queries} queries, ${r.clicks} clicks seen, ${r.inserted} new`);
    // Grouped, not one line per failure: a dead account fails on all 90 of its
    // days, and 90 identical lines would bury the one that matters.
    const byError = new Map();
    for (const s of r.skipped) {
        const key = `${s.customerId}: ${s.error}`;
        byError.set(key, (byError.get(key) ?? 0) + 1);
    }
    for (const [key, n] of byError) console.log(`[clicks]   ${n}x ${key}`);
}

const arg = process.argv[2];
if (arg) {
    await runOrg(arg);
} else {
    const { data } = await supabase_1.serviceClient
        .from('integrations')
        .select('organisation_id')
        .eq('provider', 'google_ads')
        .in('status', ['active', 'failed']);
    for (const row of data ?? []) await runOrg(row.organisation_id);
}
process.exit(0);
