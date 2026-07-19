import * as format_1 from "./daily-report.format.js";
import { whatsappReportRepository } from "../repositories/whatsapp-report.repository.js";
import { postToInboundWebhook } from "../lib/integrations/ghl-webhook.js";
import { adAttributionService } from "./ad-attribution.service.js";
import { cockpitService } from "./cockpit.service.js";
import { analyticsService } from "./analytics.service.js";

// Dependencies are injected so tests never touch the network or the real
// service graph. Production callers omit `deps` and get these.
function defaultDeps() {
    return {
        adAttribution: adAttributionService,
        cockpit: cockpitService,
        analytics: analyticsService,
        postWebhook: postToInboundWebhook,
    };
}

const byChannel = (channels, key) => channels.find((c) => c.channel === key) ?? {};

export const dailyReportService = {
    async buildMetrics(orgId, { now = new Date(), deps = defaultDeps() } = {}) {
        const day = format_1.previousDayInLondon(now);
        const window = { since: day.since, until: day.until };

        // Ad metrics are mandatory — without them there is no report worth sending.
        const perf = await deps.adAttribution.getPerformance(orgId, window);
        const google = byChannel(perf.channels, 'google_ads');
        const meta = byChannel(perf.channels, 'meta_ads');
        const totals = perf.totals ?? {};

        // Cash and clinical figures are best-effort: a failing rollup should
        // degrade the report, not cancel it.
        let cashInPence = null;
        try {
            const cockpit = await deps.cockpit.build(orgId, window);
            cashInPence = cockpit?.revenue?.month?.todayPence ?? null;
        } catch (err) {
            console.error(`[daily-report] cockpit build failed for ${orgId}`, err);
        }

        let dentally = null;
        let qbo = null;
        try {
            const hub = await deps.analytics.businessHub(orgId, { ...window, label: 'Daily report' });
            const g = hub?.group ?? {};
            // Units verified in Step 1 (backend/src/services/analytics.service.js):
            //   - group.noShowRate = rate(totalNoShows, totalAppts), where
            //     rate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
            //     -> this is ALREADY a 0..100 percentage (e.g. 5.9 for 5.9%), NOT a
            //     0..1 ratio. formatPercent()/formatReportLine's dnaRate expects a
            //     0..1 ratio (it multiplies by 100 itself), so we divide by 100 here.
            //   - group.marginPct = calculatePL(...).marginPct =
            //     (netProfit / revenue) * 100 -> ALREADY an 0..100 percentage
            //     (e.g. 18.4), and formatReportLine's qbo.marginPct branch consumes
            //     it directly (no further scaling) — so it is passed through as-is.
            if (g.appointments !== undefined && g.appointments !== null) {
                dentally = {
                    appointments: g.appointments,
                    dna: g.noShows ?? 0,
                    dnaRate: (g.noShowRate === null || g.noShowRate === undefined) ? null : g.noShowRate / 100,
                    newPatients: g.newPatients ?? 0,
                };
            }
            if (g.revenuePence !== undefined && g.revenuePence !== null) {
                qbo = { revenueMtdPence: g.revenuePence, marginPct: g.marginPct ?? null };
            }
        } catch (err) {
            console.error(`[daily-report] businessHub failed for ${orgId}`, err);
        }

        return {
            reportDate: day.date,
            reportDateLabel: day.label,
            leads: {
                total: totals.leads ?? 0,
                google: google.leads ?? 0,
                meta: meta.leads ?? 0,
            },
            spendPence: {
                total: totals.spendPence ?? null,
                google: google.spendPence ?? null,
                meta: meta.spendPence ?? null,
            },
            cplPence: {
                total: totals.costPerLeadPence ?? null,
                google: google.costPerLeadPence ?? null,
                meta: meta.costPerLeadPence ?? null,
            },
            conversions: totals.conversions ?? 0,
            conversionRate: totals.conversionRate ?? null,
            cpaPence: totals.costPerAcquisitionPence ?? null,
            cashInPence,
            dentally,
            qbo,
        };
    },

    async buildPayload(orgId, { now = new Date(), deps = defaultDeps(), organisationName = null } = {}) {
        const metrics = await this.buildMetrics(orgId, { now, deps });
        const line = format_1.formatReportLine(metrics);
        const f = format_1.formatPence;
        const p = format_1.formatPercent;

        const payload = {
            report_date: metrics.reportDate,
            report_date_label: metrics.reportDateLabel,
            organisation: organisationName,
            report_line: line,

            leads_total: metrics.leads.total,
            leads_google: metrics.leads.google,
            leads_meta: metrics.leads.meta,

            spend_total: f(metrics.spendPence.total) ?? 'not reporting',
            spend_google: f(metrics.spendPence.google) ?? 'not reporting',
            spend_meta: f(metrics.spendPence.meta) ?? 'not reporting',

            cpl_total: f(metrics.cplPence.total) ?? 'n/a',
            cpl_google: f(metrics.cplPence.google) ?? 'n/a',
            cpl_meta: f(metrics.cplPence.meta) ?? 'n/a',

            conversions: metrics.conversions,
            conversion_rate: p(metrics.conversionRate) ?? 'n/a',
            cpa: f(metrics.cpaPence) ?? 'n/a',
            cash_in: f(metrics.cashInPence) ?? 'n/a',
        };

        if (metrics.dentally) {
            payload.appointments = metrics.dentally.appointments;
            payload.dna = metrics.dentally.dna;
            payload.dna_rate = p(metrics.dentally.dnaRate) ?? 'n/a';
            payload.new_patients = metrics.dentally.newPatients;
        }
        if (metrics.qbo) {
            payload.qbo_revenue_mtd = f(metrics.qbo.revenueMtdPence) ?? 'n/a';
            payload.qbo_margin = metrics.qbo.marginPct === null ? 'n/a' : `${Math.round(metrics.qbo.marginPct * 10) / 10}%`;
        }

        return { metrics, payload, line };
    },

    // A day with no leads, no spend and no cash is not worth a message.
    // A digest full of zeroes trains the reader to ignore the digest.
    _hasContent(metrics) {
        return (metrics.leads.total ?? 0) > 0
            || metrics.spendPence.total !== null
            || metrics.cashInPence !== null;
    },

    _sameLondonDay(a, b) {
        const day = (d) => new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(d);
        return day(a) === day(b);
    },

    async send(orgId, { now = new Date(), trigger = 'cron', deps = defaultDeps(), settings = undefined, organisationName = null } = {}) {
        const cfg = settings ?? await whatsappReportRepository.get(orgId);
        if (!cfg || !cfg.webhookUrl) {
            return { sent: false, status: 'skipped', reason: 'not configured' };
        }
        if (trigger === 'cron' && !cfg.enabled) {
            return { sent: false, status: 'skipped', reason: 'disabled' };
        }
        // A worker restart at 18:05 must not send the report twice.
        // Manual sends bypass this deliberately. Gate on the last outcome
        // having been a SUCCESS: a failed attempt earlier the same day must
        // not block a retry, or a dead webhook silently blacks out the day.
        if (trigger === 'cron' && cfg.lastSentAt && cfg.lastStatus === 'ok' && this._sameLondonDay(new Date(cfg.lastSentAt), now)) {
            return { sent: false, status: 'skipped', reason: 'already sent today' };
        }

        // Ad metrics are mandatory (see buildMetrics): a dead ad integration
        // must resolve to a failed result like every other failure path in
        // `send`, not throw out of it.
        let metrics;
        let payload;
        try {
            ({ metrics, payload } = await this.buildPayload(orgId, { now, deps, organisationName }));
        } catch (err) {
            console.error(`[daily-report] buildPayload failed for ${orgId}`, err);
            await whatsappReportRepository.markSent(orgId, {
                status: 'failed', error: err.message, payload: null, sentAt: now.toISOString(),
            });
            return { sent: false, status: 'failed', reason: err.message };
        }

        if (!this._hasContent(metrics)) {
            await whatsappReportRepository.markSent(orgId, {
                status: 'skipped', error: 'no data for the reporting day', payload: null, sentAt: now.toISOString(),
            });
            return { sent: false, status: 'skipped', reason: 'no data' };
        }

        const result = await deps.postWebhook(cfg.webhookUrl, payload);

        await whatsappReportRepository.markSent(orgId, {
            status: result.ok ? 'ok' : 'failed',
            error: result.ok ? null : result.error,
            payload,
            sentAt: now.toISOString(),
        });

        return {
            sent: result.ok,
            status: result.ok ? 'ok' : 'failed',
            reason: result.ok ? undefined : result.error,
            payload,
        };
    },
};

/**
 * Cron entry point. One organisation failing must never stop the rest, so
 * every send is individually caught — this mirrors the isolation in
 * gohighlevel-sync's syncAllOrgs.
 */
export async function runDailyWhatsappReports({ now = new Date(), deps = {} } = {}) {
    const repo = deps.repo ?? whatsappReportRepository;
    const send = deps.send ?? ((orgId, opts) => dailyReportService.send(orgId, opts));

    const rows = await repo.listEnabled();
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
        try {
            const result = await send(row.organisationId, { now, trigger: 'cron', settings: row });
            if (result.sent) sent++;
            else skipped++;
        } catch (err) {
            failed++;
            console.error(`[worker] daily whatsapp report failed for org ${row.organisationId}`, err);
        }
    }

    return { sent, skipped, failed };
}
