// ============================================================================
// Background workers — cron jobs (native ESM)
// ============================================================================
// Run as separate Railway service: `node src/workers/index.js`
// Cron schedules driven by node-cron
// ============================================================================
import "dotenv/config";
// Sentry MUST load after dotenv (so SENTRY_DSN is populated) and before the
// jobs run, so the worker process gets its own Sentry init. server.js loads
// instrument.js too, but workers are a SEPARATE process and would otherwise
// have no Sentry. No-op when SENTRY_DSN is unset (local/dev).
import Sentry from "../instrument.js";
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
import * as meta_ads_sync_1 from "../lib/integrations/meta-ads-sync.js";
import * as reviews_sync_1 from "../lib/integrations/reviews-sync.js";
import * as emergent_sync_1 from "../lib/integrations/emergent-sync.js";
import * as callrail_sync_1 from "../lib/integrations/callrail-sync.js";
import * as google_sheets_sync_1 from "../lib/integrations/google-sheets-sync.js";
import * as aws_ses_1 from "../lib/aws-ses.js";
import * as aws_sns_1 from "../lib/aws-sns.js";
import { notificationService } from "../services/notification.service.js";
import { analyticsService } from "../services/analytics.service.js";
import { getSnapshot, finalizePreviousMonth } from "../services/ai-context.service.js";
import { boardReportRepository, isScheduleDue } from "../repositories/boardReport.repository.js";
import { runDailyWhatsappReports } from "../services/daily-report.service.js";

// --------------------------------------------------------------------------
// Cron monitoring helper. Wraps every node-cron job in Sentry.withMonitor so
// Sentry tracks check-ins (started/ok/error), missed runs, and overruns. The
// monitorConfig is sent on each check-in, so monitors auto-provision in Sentry
// (no manual dashboard setup). No-op when SENTRY_DSN is unset.
//
//   slug       — stable Sentry monitor slug (kebab-case, do not rename)
//   cronExpr   — same crontab string passed to node-cron
//   fn         — async job body
//   opts       — { timezone?, maxRuntime?, checkinMargin? }
//
// withMonitor reports the job as ERROR only if fn throws; jobs that swallow
// errors in their own try/catch will check in OK (runtime/missed monitoring
// still works). To flag a logic failure to Sentry, let it throw or rethrow.
// --------------------------------------------------------------------------
function scheduleMonitored(slug, cronExpr, fn, opts = {}) {
    const monitorConfig = {
        schedule: { type: 'crontab', value: cronExpr },
        checkinMargin: opts.checkinMargin ?? 5,   // minutes a late start tolerated
        maxRuntime: opts.maxRuntime ?? 30,        // minutes before flagged as overrun
        ...(opts.timezone ? { timezone: opts.timezone } : {}),
    };
    const cronOpts = opts.timezone ? { timezone: opts.timezone } : undefined;
    return node_cron_1.default.schedule(
        cronExpr,
        () => Sentry.withMonitor(slug, fn, monitorConfig),
        cronOpts,
    );
}
// --------------------------------------------------------------------------
// Business-health snapshot — daily 02:00 UTC, decides per-org by cadence.
// Phase 2: replaces stub baseline-copy with formula-driven calc against real
// payments/leads/appointments tables. Cadence per-org via
// business_health.snapshot_frequency ('weekly' | 'monthly').
// --------------------------------------------------------------------------
scheduleMonitored('business-health-snapshot', '0 2 * * *', async () => {
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
}, { maxRuntime: 55 });
// --------------------------------------------------------------------------
// Weekly digest email — Mondays 07:00 UK time
// --------------------------------------------------------------------------
scheduleMonitored('weekly-digest', '0 6 * * 1', async () => {
    console.log('[worker] Running weekly digest');
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id, name, users(id, email, full_name, role)')
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
                await notificationService.notify({
                    orgId: org.id,
                    userIds: [owner.id],
                    category: 'digest',
                    title: `Your weekly digest — ${org.name}`,
                    body: 'Your weekly business snapshot is ready.',
                    link: '/overview',
                    recipients: { [owner.id]: { email: null, phone: null } },
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
scheduleMonitored('workflow-runner', '* * * * *', async () => {
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
}, { maxRuntime: 5 });
// --------------------------------------------------------------------------
// Dentally sync — daily 03:00 RECONCILIATION backstop. Real-time updates now
// arrive via the Dentally webhook (POST /webhooks/dentally/:token); this poll
// only re-pulls the changed window to catch any missed/dropped webhook
// deliveries (webhooks can be unreliable — see dentally-sync.js header).
// First pull also happens on connect; owners can Refresh on demand via
// POST /integrations/dentally/sync.
// --------------------------------------------------------------------------
scheduleMonitored('dentally-sync', '0 3 * * *', async () => {
    try {
        const results = await dentally_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Dentally sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Dentally sync failed', err);
    }
}, { maxRuntime: 55 });
// --------------------------------------------------------------------------
// GoHighLevel inbound sync — nightly at 22:00 UK time, pull
// contacts/opportunities/conversations + refresh pipeline & workflow caches for
// orgs with an active gohighlevel integration.
// --------------------------------------------------------------------------
scheduleMonitored('gohighlevel-sync', '0 22 * * *', async () => {
    try {
        const results = await gohighlevel_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] GoHighLevel nightly sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] GoHighLevel sync failed', err);
    }
}, { timezone: 'Europe/London', maxRuntime: 55 });
// Second daily GHL pull at 18:00 UK — same incremental syncAllOrgs, so leads
// created during the working day land before end of day instead of waiting
// for the 22:00 run (feeds the CRM screens and the sheet conversion export,
// whose 15-min sweep re-checks no_match patients right after).
scheduleMonitored('gohighlevel-sync-evening', '0 18 * * *', async () => {
    try {
        const results = await gohighlevel_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] GoHighLevel evening sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] GoHighLevel evening sync failed', err);
    }
}, { timezone: 'Europe/London', maxRuntime: 55 });
// --------------------------------------------------------------------------
// Xero P&L sync — daily 02:15, pull the month's Profit & Loss into
// monthly_financials for orgs with an active xero integration.
// --------------------------------------------------------------------------
scheduleMonitored('xero-sync', '15 2 * * *', async () => {
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
scheduleMonitored('quickbooks-sync', '30 2 * * *', async () => {
    try {
        const results = await quickbooks_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] QuickBooks sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] QuickBooks sync failed', err);
    }
});
// Google Ads spend sync — daily 02:45, resync the trailing 3 months of
// per-campaign spend/performance into ad_metrics for orgs with an active OR
// failed google_ads integration (failed ones self-heal). Each org's rows are
// keyed by organisation_id (no cross-tenant).
scheduleMonitored('google-ads-sync', '45 2 * * *', async () => {
    try {
        const results = await google_ads_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Google Ads sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Google Ads sync failed', err);
    }
});
// Meta (Facebook) Ads spend sync — daily 02:50, resync the trailing 3 months of
// per-campaign spend/performance into ad_metrics for orgs with an active OR
// failed meta_ads integration (failed ones self-heal). Each org's rows are
// keyed by organisation_id.
scheduleMonitored('meta-ads-sync', '50 2 * * *', async () => {
    try {
        const results = await meta_ads_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Meta Ads sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Meta Ads sync failed', err);
    }
});
// Reviews sync — daily 03:10. Pull Google (Places) + Facebook (Graph) reviews
// for every org with at least one selected review_source into the reviews table
// and refresh each source's overall rating + total count. Per-source failures
// are isolated; one bad place_id or a pending Meta scope won't stop the rest.
scheduleMonitored('reviews-sync', '10 3 * * *', async () => {
    try {
        const results = await reviews_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Reviews sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Reviews sync failed', err);
    }
}, { maxRuntime: 30 });
// Emergent (Treatments Accepted) sync — daily 03:20, incremental pull of accepted
// treatments for every org with an active emergent integration.
scheduleMonitored('emergent-sync', '20 3 * * *', async () => {
    try {
        const results = await emergent_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Emergent sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Emergent sync failed', err);
    }
}, { maxRuntime: 30 });
// CallRail call-tracking pull — daily 03:30, per company (status IN
// ('active','failed'), so one transient failure self-heals next run — see
// callrail-sync.js's own header). This is the load-bearing path, not
// belt-and-braces: CallRail never resends a webhook delivery, so anything
// lost to a deploy/outage — or predating a company's connection — is only
// ever recovered here.
scheduleMonitored('callrail-sync', '30 3 * * *', async () => {
    try {
        const results = await callrail_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] CallRail sync: ${results.length} companies`);
    } catch (err) {
        console.error('[worker] CallRail sync failed', err);
    }
}, { maxRuntime: 30 });
// Google Sheets (Call Reporting) sync — daily 03:40, full re-read of every
// configured sheet source. Catches in-place row EDITS (e.g. first-call time
// filled in later) that the on-view append-only top-up cannot see. Per-org
// failures are isolated inside syncAllOrgs and failed sources are retried.
scheduleMonitored('google-sheets-sync', '40 3 * * *', async () => {
    try {
        const results = await google_sheets_sync_1.syncAllOrgs();
        if (results.length > 0) console.log(`[worker] Sheets sync: ${results.length} orgs`);
    } catch (err) {
        console.error('[worker] Sheets sync failed', err);
    }
}, { maxRuntime: 30 });
// Sheet-export drain — every 15 min: enqueue+match+append for every org with
// a google_sheets_writer connection. Catches sync-path appointments, retries
// transient Google failures (backoff lives in the claim RPC), and nightly-ish
// revisits young no_match rows. Real-time comes from the Dentally webhook kick.
// Sheet-export refresh — nightly 04:30 UK: re-derive each exported row's
// Status/Invoiced/Collected cells from live Dentally data and update them in
// place (rows found via the hidden Export ID column). Runs after the 22:00
// GHL sync and the overnight Dentally pulls so the numbers reflect yesterday.
scheduleMonitored('sheet-export-refresh', '30 4 * * *', async () => {
    try {
        const { sheetExportService } = await import('../services/sheet-export.service.js');
        const results = await sheetExportService.refreshAllOrgs();
        const active = results.filter((r) => (r.refreshed ?? 0) > 0);
        if (active.length > 0) console.log(`[worker] Sheet refresh: ${JSON.stringify(active)}`);
    } catch (err) {
        console.error('[worker] Sheet export refresh failed', err);
    }
}, { timezone: 'Europe/London', maxRuntime: 30 });
scheduleMonitored('sheet-export-drain', '*/15 * * * *', async () => {
    try {
        const { sheetExportService } = await import('../services/sheet-export.service.js');
        const results = await sheetExportService.drainAllOrgs();
        const active = results.filter((r) => (r.exported ?? 0) + (r.retried ?? 0) + (r.noMatch ?? 0) > 0);
        if (active.length > 0) console.log(`[worker] Sheet export: ${JSON.stringify(active)}`);
    } catch (err) {
        console.error('[worker] Sheet export drain failed', err);
    }
}, { maxRuntime: 10 });
// --------------------------------------------------------------------------
// Task overdue auto-reminders — daily 08:00 UK time. Email the assignee of
// every open/in-progress task whose due_date has passed, throttled to once a
// day (skip if last_reminded_at is today). Bumps reminder_count so the Task
// Manager shows "X sent". Owner-only manual sends use the same email path.
// --------------------------------------------------------------------------
scheduleMonitored('task-overdue-reminders', '0 8 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const { data: tasks, error } = await supabase_1.serviceClient
            .from('tasks')
            .select('id, organisation_id, title, description, priority, due_date, reminder_count, last_reminded_at, assignee:users!tasks_assigned_to_fkey(full_name, email)')
            .in('status', ['open', 'in_progress'])
            .lt('due_date', today);
        if (error) throw new Error(error.message);
        let sent = 0;
        for (const t of tasks || []) {
            const to = t.assignee?.email;
            if (!to) continue;
            // Throttle: one auto-reminder per task per day.
            if (t.last_reminded_at && t.last_reminded_at.split('T')[0] === today) continue;
            const due = t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB') : 'no due date';
            try {
                await messaging_1.sendEmail({
                    orgId: t.organisation_id,
                    to,
                    subject: `Overdue: ${t.title}`,
                    body: `A task assigned to you is overdue.\n\nTask: ${t.title}\n${t.description ? `Notes: ${t.description}\n` : ''}Priority: ${t.priority}\nWas due: ${due}\n\nPlease update its status in the Task Manager.`,
                });
                await supabase_1.serviceClient
                    .from('tasks')
                    .update({ reminder_count: (t.reminder_count || 0) + 1, last_reminded_at: new Date().toISOString() })
                    .eq('id', t.id)
                    .eq('organisation_id', t.organisation_id);
                sent++;
            } catch (err) {
                console.error(`[worker] task reminder failed for ${t.id}`, err);
            }
        }
        if (sent > 0) console.log(`[worker] Task overdue reminders: ${sent} sent`);
    } catch (err) {
        console.error('[worker] Task reminder job failed', err);
    }
}, { timezone: 'Europe/London' });

// --------------------------------------------------------------------------
// Notification outbox drain — every minute.
// --------------------------------------------------------------------------
scheduleMonitored('notification-outbox-drain', '* * * * *', async () => {
    try {
        const n = await notificationService.drainOnce({ ses: aws_ses_1, sns: aws_sns_1 });
        if (n) console.log(`[worker] drained ${n} notification deliveries`);
    } catch (err) {
        console.error('[worker] notification drain failed', err);
    }
}, { maxRuntime: 5 });

// --------------------------------------------------------------------------
// Board Report Generator delivery — daily 06:30 Europe/London. Scans all
// active board_report_schedules, sends the ones DUE by cadence (daily = once a
// day, weekly >7d, monthly >28d), then stamps last_sent_at. Each pack is
// computed live from the org's current analytics rollups at send time.
// --------------------------------------------------------------------------
scheduleMonitored('board-report-delivery', '30 6 * * *', async () => {
    let sent = 0;
    try {
        const schedules = await boardReportRepository.activeAcrossOrgs();
        const now = new Date();
        for (const s of schedules) {
            if (!isScheduleDue(s.frequency, s.last_sent_at, now)) continue;
            try {
                const label = `${s.frequency[0].toUpperCase()}${s.frequency.slice(1)} board pack`;
                const { delivery } = await analyticsService.emailBoardReport(s.organisation_id, {
                    recipientEmail: s.recipient_email,
                    label,
                });
                await boardReportRepository.markSent(s.id, now.toISOString());
                if (delivery.sent) sent++;
                else console.error(`[worker] board report SES send failed for schedule ${s.id}: ${delivery.error}`);
            } catch (err) {
                console.error(`[worker] board report schedule ${s.id} failed`, err);
            }
        }
        if (sent > 0) console.log(`[worker] Board reports: ${sent} sent`);
    } catch (err) {
        console.error('[worker] Board report delivery job failed', err);
    }
}, { timezone: 'Europe/London' });

// --------------------------------------------------------------------------
// Daily WhatsApp report — daily 18:00 Europe/London. Scans every org with
// an enabled webhook and sends yesterday's ads/cash/clinical digest. One
// organisation's failure must never block the rest (see runDailyWhatsappReports).
// --------------------------------------------------------------------------
scheduleMonitored('daily-whatsapp-report', '0 18 * * *', async () => {
    try {
        const { sent, skipped, failed } = await runDailyWhatsappReports({ now: new Date() });
        console.log(`[worker] Daily WhatsApp reports: ${sent} sent, ${skipped} skipped, ${failed} failed`);
    } catch (err) {
        console.error('[worker] Daily WhatsApp report job failed', err);
    }
}, { timezone: 'Europe/London' });

// --------------------------------------------------------------------------
// AI context snapshot warm — nightly 02:30 UTC. Build/refresh the current-month
// snapshot for every org so the first AI call of the day is already cached.
// --------------------------------------------------------------------------
scheduleMonitored('ai-context-warm', '30 2 * * *', async () => {
    const { data: orgs } = await supabase_1.serviceClient.from('organisations').select('id');
    for (const o of orgs || []) {
        try { await getSnapshot(o.id, 'current'); }
        catch (e) { console.warn('[ai-context] warm failed', o.id, e.message); }
    }
}, { maxRuntime: 55 });

// --------------------------------------------------------------------------
// AI context snapshot finalize — day 3 of each month 03:00 UTC. Freeze the
// previous month for every org (build if needed, then upsert as final).
// --------------------------------------------------------------------------
scheduleMonitored('ai-context-finalize', '0 3 3 * *', async () => {
    const { data: orgs } = await supabase_1.serviceClient.from('organisations').select('id');
    for (const o of orgs || []) {
        try { await finalizePreviousMonth(o.id); }
        catch (e) { console.warn('[ai-context] finalize failed', o.id, e.message); }
    }
}, { maxRuntime: 55 });

// --------------------------------------------------------------------------
// Business Hub cache warmer — every 5 minutes.
//
// The payload cache only helps the SECOND viewer inside its TTL; the first
// load after each expiry still pays for 16 aggregates and is the slow one
// people actually notice. Recomputing it on a schedule means a real page load
// is almost always a cache hit. The TTL (10 min) is deliberately longer than
// this interval so a single slow run never leaves a gap.
//
// Only the default current-month, all-practices window is warmed — the shape
// every dashboard opens on. Narrower scopes still compute on demand.
// --------------------------------------------------------------------------
scheduleMonitored('business-hub-warm', '*/5 * * * *', async () => {
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id')
        .neq('subscription_plan', 'cancelled');
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    for (const o of orgs || []) {
        try {
            // Force a recompute so the cached copy is refreshed rather than
            // re-read: invalidate, then populate both tiers.
            analyticsService.invalidateBusinessHub(o.id);
            await analyticsService.businessHub(o.id, { since, until, label: 'month' });
        } catch (e) {
            console.warn('[business-hub-warm] failed', o.id, e.message);
        }
    }
}, { maxRuntime: 240 });

console.log('[workers] Started — cron schedules active');
