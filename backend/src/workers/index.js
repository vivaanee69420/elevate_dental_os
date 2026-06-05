// ============================================================================
// Background workers — cron jobs (native ESM)
// ============================================================================
// Run as separate Railway service: `node src/workers/index.js`
// Cron schedules driven by node-cron
// ============================================================================
import "dotenv/config";
import * as node_cron_1 from "node-cron";
import * as supabase_1 from "../lib/supabase.js";
import * as postmark_1 from "../lib/postmark.js";
import * as messaging_1 from "../lib/messaging.js";
import * as formulas_1 from "../lib/formulas.js";
import * as snapshot_utils_1 from "../lib/snapshot-utils.js";
import * as dentally_sync_1 from "../lib/integrations/dentally-sync.js";
import * as gohighlevel_sync_1 from "../lib/integrations/gohighlevel-sync.js";
import * as xero_sync_1 from "../lib/integrations/xero-sync.js";
import * as quickbooks_sync_1 from "../lib/integrations/quickbooks-sync.js";
import * as google_ads_sync_1 from "../lib/integrations/google-ads-sync.js";
// --------------------------------------------------------------------------
// Business-health snapshot — daily 02:00 UTC, decides per-org by cadence.
// Phase 2: replaces stub baseline-copy with formula-driven calc against real
// payments/leads/appointments tables. Cadence per-org via
// business_health.snapshot_frequency ('weekly' | 'monthly').
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 2 * * *', async () => {
    console.log('[worker] Running snapshot tick');
    const today = new Date();
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id, business_health(snapshot_frequency, baseline, last_snapshot_at)')
        .neq('subscription_plan', 'cancelled');
    let fired = 0;
    for (const org of orgs || []) {
        const bh = Array.isArray(org.business_health) ? org.business_health[0] : org.business_health;
        if (!bh) continue;
        const frequency = bh.snapshot_frequency ?? 'monthly';
        if (!snapshot_utils_1.isDueForSnapshot(frequency, today, bh.last_snapshot_at)) continue;

        const from = snapshot_utils_1.windowStart(frequency, today);
        try {
            const [payments, leads, appointments] = await Promise.all([
                supabase_1.serviceClient.from('payments')
                    .select('amount_pence, source, processed_at, status, method')
                    .eq('organisation_id', org.id)
                    .gte('processed_at', from.toISOString()),
                supabase_1.serviceClient.from('leads')
                    .select('source, source_provider, status, estimated_value_pence, created_at')
                    .eq('organisation_id', org.id)
                    .gte('created_at', from.toISOString()),
                supabase_1.serviceClient.from('appointments')
                    .select('source, status, starts_at')
                    .eq('organisation_id', org.id)
                    .gte('starts_at', from.toISOString()),
            ]);

            const pl = formulas_1.calculatePL?.(payments.data ?? [], bh.baseline ?? {}) ?? null;
            const metrics = {
                pl,
                revenue: Math.round((pl?.revenue || 0) / 100),
                profit: Math.round((pl?.netProfit || 0) / 100),
                // LTV from the saved baseline (active_patients / new_per_month /
                // revenue / profit). The old call passed payment+appointment
                // ARRAYS to calculateLTV, which expects a {averageAnnualSpendPence,
                // averageRetentionYears, netMarginPct} object → produced NaN.
                ltv: formulas_1.ltvFromBaseline?.(bh.baseline) ?? null,
                marketingROI: formulas_1.calculateMarketingROI?.(leads.data ?? [], payments.data ?? []) ?? null,
                window: { from: from.toISOString(), to: today.toISOString() },
                source_breakdown: snapshot_utils_1.countBySource(payments.data, leads.data, appointments.data),
                counts: {
                    payments: payments.data?.length ?? 0,
                    leads: leads.data?.length ?? 0,
                    appointments: appointments.data?.length ?? 0,
                },
            };

            await supabase_1.serviceClient.from('business_health_snapshots').insert({
                organisation_id: org.id,
                snapshot_date: today.toISOString().split('T')[0],
                label: snapshot_utils_1.snapshotLabel(frequency, today),
                metrics,
            });

            await supabase_1.serviceClient.from('business_health')
                .update({ last_snapshot_at: today.toISOString() })
                .eq('organisation_id', org.id);
            fired++;
        } catch (err) {
            console.error(`Snapshot failed for org ${org.id}`, err);
        }
    }
    console.log(`[worker] Snapshot tick complete — ${fired} orgs snapshotted`);
});
// --------------------------------------------------------------------------
// Weekly digest email — Mondays 07:00 UK time
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 6 * * 1', async () => {
    console.log('[worker] Running weekly digest');
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id, name, users(email, full_name, role)')
        .neq('subscription_plan', 'cancelled');
    for (const org of orgs || []) {
        const owners = org.users?.filter((u) => u.role === 'owner') || [];
        for (const owner of owners) {
            try {
                await messaging_1.sendEmail({
                    orgId: org.id,
                    to: owner.email,
                    subject: `Your Elevate weekly digest — ${org.name}`,
                    body: `<h2>This week at ${org.name}</h2><p>Hi ${owner.full_name},</p><p>Your weekly business snapshot...</p>`,
                });
            }
            catch (err) {
                console.error(`Weekly digest failed for ${owner.email}`, err);
            }
        }
    }
});
// --------------------------------------------------------------------------
// Workflow runner — every minute, process pending workflow steps
// --------------------------------------------------------------------------
node_cron_1.default.schedule('* * * * *', async () => {
    const { data: runs } = await supabase_1.serviceClient
        .from('workflow_runs')
        .select('*, workflow:workflows(*)')
        .eq('status', 'running')
        .lte('next_step_at', new Date().toISOString())
        .limit(50);
    for (const run of runs || []) {
        try {
            const workflow = run.workflow;
            if (!workflow)
                continue;
            const steps = workflow.steps || [];
            const nextStep = steps[run.current_step];
            if (!nextStep) {
                await supabase_1.serviceClient
                    .from('workflow_runs')
                    .update({ status: 'completed', completed_at: new Date().toISOString() })
                    .eq('id', run.id);
                continue;
            }
            // Execute step (send email, send SMS, wait, etc.)
            if (nextStep.type === 'send_email' && nextStep.template) {
                const { data: contact } = await supabase_1.serviceClient
                    .from('contacts')
                    .select('email, first_name')
                    .eq('id', run.contact_id)
                    .single();
                if (contact?.email) {
                    await messaging_1.sendEmail({
                        orgId: run.organisation_id,
                        to: contact.email,
                        subject: nextStep.subject || 'Update from us',
                        body: (nextStep.body || '').replace('{{first_name}}', contact.first_name || ''),
                    });
                }
            }
            // Advance to next step
            const delayMs = (nextStep.delay_hours || 0) * 3600000;
            await supabase_1.serviceClient
                .from('workflow_runs')
                .update({
                current_step: run.current_step + 1,
                next_step_at: new Date(Date.now() + delayMs).toISOString(),
            })
                .eq('id', run.id);
        }
        catch (err) {
            console.error(`Workflow run ${run.id} failed`, err);
            await supabase_1.serviceClient
                .from('workflow_runs')
                .update({ status: 'failed' })
                .eq('id', run.id);
        }
    }
});
// --------------------------------------------------------------------------
// Dentally sync — daily 03:00 RECONCILIATION backstop. Real-time updates now
// arrive via the Dentally webhook (POST /webhooks/dentally/:token); this poll
// only re-pulls the changed window to catch any missed/dropped webhook
// deliveries (webhooks can be unreliable — see dentally-sync.js header).
// First pull also happens on connect; owners can Refresh on demand via
// POST /integrations/dentally/sync.
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 3 * * *', async () => {
    try {
        const results = await dentally_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Dentally sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Dentally sync failed', err);
    }
});
// --------------------------------------------------------------------------
// GoHighLevel inbound sync — nightly at 22:00 UK time, pull
// contacts/opportunities/conversations + refresh pipeline & workflow caches for
// orgs with an active gohighlevel integration.
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 22 * * *', async () => {
    try {
        const results = await gohighlevel_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] GoHighLevel nightly sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] GoHighLevel sync failed', err);
    }
}, { timezone: 'Europe/London' });
// --------------------------------------------------------------------------
// Xero P&L sync — daily 02:15, pull the month's Profit & Loss into
// monthly_financials for orgs with an active xero integration.
// --------------------------------------------------------------------------
node_cron_1.default.schedule('15 2 * * *', async () => {
    try {
        const results = await xero_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Xero sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Xero sync failed', err);
    }
});
// --------------------------------------------------------------------------
// QuickBooks P&L sync — daily 02:30, pull the month's Profit & Loss into
// monthly_financials for orgs with an active quickbooks integration.
// --------------------------------------------------------------------------
node_cron_1.default.schedule('30 2 * * *', async () => {
    try {
        const results = await quickbooks_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] QuickBooks sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] QuickBooks sync failed', err);
    }
});
// Google Ads spend sync — daily 02:45, pull the last 30 days of per-campaign
// spend/performance into ad_metrics for orgs with an active google_ads
// integration. Each org's rows are keyed by organisation_id (no cross-tenant).
node_cron_1.default.schedule('45 2 * * *', async () => {
    try {
        const results = await google_ads_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Google Ads sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Google Ads sync failed', err);
    }
});

console.log('[workers] Started — cron schedules active');
