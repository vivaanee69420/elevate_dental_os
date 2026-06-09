import * as analytics_service_1 from "../services/analytics.service.js";
import * as analytics_model_1 from "../models/analytics.model.js";
import { idParamSchema, practiceQuerySchema } from "../models/common.model.js";
export const analyticsController = {
    async dashboard(req, res) {
        res.json(await analytics_service_1.analyticsService.dashboard(req.user.organisation_id));
    },
    async dashboardSummary(req, res) {
        const q = analytics_model_1.seriesQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.dashboardSummary(req.user.organisation_id, { from: q.from, to: q.to, practiceId: q.practice_id }));
    },
    async revenueSeries(req, res) {
        const q = analytics_model_1.seriesQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.revenueSeries(req.user.organisation_id, { months: q.months, from: q.from, to: q.to, practiceId: q.practice_id }));
    },
    async financeSeries(req, res) {
        const q = analytics_model_1.seriesQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.financeSeries(req.user.organisation_id, { months: q.months, practiceId: q.practice_id, from: q.from, to: q.to }));
    },
    async cashflowOutlook(req, res) {
        const q = analytics_model_1.outlookQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.cashflowOutlook(req.user.organisation_id, { months: q.months, forward: q.forward, practiceId: q.practice_id }));
    },
    async cashflow(req, res) {
        const q = analytics_model_1.weeksQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.cashflow(req.user.organisation_id, { weeks: q.weeks, practiceId: q.practice_id, from: q.from, to: q.to }));
    },
    async financial(req, res) {
        const q = analytics_model_1.financialQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.financial(req.user.organisation_id, { dsoDays: q.dsoDays, payableDays: q.payableDays, practiceId: q.practice_id, from: q.from, to: q.to }));
    },
    async practiceSummary(req, res) {
        res.json(await analytics_service_1.analyticsService.practiceSummary(req.user.organisation_id));
    },
    async aiInsights(req, res) {
        const q = analytics_model_1.windowQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.aiInsights(req.user.organisation_id, { days: q.days }));
    },
    async generateInsights(req, res) {
        res.json(await analytics_service_1.analyticsService.generateInsights(req.user.organisation_id));
    },
    async pl(req, res) {
        const { practice_id: practiceId } = practiceQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.pl(req.user.organisation_id, { practiceId }));
    },
    async plBenchmark(req, res) {
        const { practice_id: practiceId } = practiceQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.plBenchmark(req.user.organisation_id, { practiceId }));
    },
    // P&L & Margin (Intelligence OS) — scope/period-aware group statement +
    // per-entity P&L from real monthly_financials actuals.
    async plMargin(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.plMargin(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
        }));
    },
    async valuation(req, res) {
        res.json(await analytics_service_1.analyticsService.valuation(req.user.organisation_id));
    },
    async kpis(req, res) {
        res.json(await analytics_service_1.analyticsService.kpis(req.user.organisation_id));
    },
    async businessHub(req, res) {
        const days = Number(req.query.days) || 90;
        // Optional explicit window (a picked month/day). Normalise to ISO; ignore
        // anything unparseable so a bad query param can't reach the SQL window.
        const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const since = iso(req.query.since);
        const until = iso(req.query.until);
        const label = typeof req.query.label === 'string' ? req.query.label.slice(0, 40) : null;
        res.json(await analytics_service_1.analyticsService.businessHub(req.user.organisation_id, { days, since, until, label }));
    },
    async leakage(req, res) {
        const days = Number(req.query.days) || 90;
        const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const since = iso(req.query.since);
        const until = iso(req.query.until);
        // Recoverable rates (0-100 per pool) arrive as ?rate_plans=30 etc. Only
        // the five known keys are read; anything else is ignored. The formula
        // clamps, but parse defensively so a junk value can't poison the calc.
        const rates = {};
        for (const k of ['plans', 'fta', 'recall', 'lapsed', 'collect']) {
            const v = Number(req.query['rate_' + k]);
            if (Number.isFinite(v)) rates[k] = v;
        }
        res.json(await analytics_service_1.analyticsService.revenueLeakage(req.user.organisation_id, { days, since, until, rates }));
    },
    async chair(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        const recoverPctPoints = Math.max(0, Math.min(40, Number(req.query.recover) || 10));
        res.json(await analytics_service_1.analyticsService.chairAnalytics(req.user.organisation_id, { scope: q.scope, recoverPctPoints, since: q.since, until: q.until }));
    },
    // Treatment Mix heat matrix (GM Intelligence OS) — scope/period-driven
    // appointment volume by type x practice. Volume only (no price; data wall).
    async treatmentMatrix(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.treatmentMatrix(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
        }));
    },
    // Treatment REVENUE heat matrix — real invoiced fee by treatment name x
    // practice (from invoice_items). Money in pence. Same shape as the volume
    // matrix so the frontend can toggle Volume/£.
    async treatmentRevenue(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.treatmentRevenueMatrix(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
        }));
    },
    // By treatment (CRM Reports) — flat invoiced-fee + distinct-patient breakdown
    // grouped by treatment_name (from invoice_items). Org-wide, optional window.
    // Money in pence. Replaces the old GHL-leads-by-opp.name grouping.
    async treatmentBreakdown(req, res) {
        const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
        const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 24));
        res.json(await analytics_service_1.analyticsService.treatmentBreakdown(req.user.organisation_id, {
            since: iso(req.query.since), until: iso(req.query.until), limit,
        }));
    },
    // AI Analyst (GM Intelligence OS) — £-ranked findings over live scope/period
    // data + a natural-language answer (Claude) to a free-text question.
    async aiAsk(req, res) {
        const b = analytics_model_1.aiAskSchema.parse(req.body);
        res.json(await analytics_service_1.analyticsService.aiAsk(req.user.organisation_id, {
            scope: b.scope, period: b.period, periodKey: b.pk, since: b.since, until: b.until, label: b.label, question: b.question,
        }));
    },
    // Clinicians (GM Intelligence OS) — per-clinician production, pay splits and
    // NHS/UDA from real associate roster + treatment_plans + appointment stats.
    async clinicians(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.clinicians(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
        }));
    },
    // Marketing & ROI (GM Intelligence OS) — per-channel acquisition economics
    // from real ad_metrics (spend) + CRM leads (attribution/conversion).
    async marketingRoi(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.marketingRoi(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
            accountIds: q.account_ids,
        }));
    },
    // Day — Cash Collected (GM Intelligence OS). Real settled receipts banked by
    // working day across the month in scope + a composite collection index.
    async cashByDay(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.cashByDay(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk, since: q.since, until: q.until, label: q.label,
        }));
    },
    // Real case-fee benchmarks (from Dentally invoice_items) to seed the
    // workbench. Patient fee only; costs stay owner-entered.
    async treatmentFeeBenchmarks(req, res) {
        const months = Math.max(1, Math.min(36, Number(req.query.months) || 12));
        res.json(await analytics_service_1.analyticsService.treatmentFeeBenchmarks(req.user.organisation_id, { months }));
    },
    // Pure compute (audit-exempt via /compute/ path) — see Arch #3.
    treatmentModels(req, res) {
        res.json(analytics_service_1.analyticsService.treatmentModels());
    },
    treatmentEconomics(req, res) {
        const model = analytics_model_1.treatmentModelSchema.parse(req.body);
        res.json(analytics_service_1.analyticsService.treatmentEconomics(model));
    },
    // Value & Growth — server-authoritative valuation compute (Arch #3).
    valuationCompute(req, res) {
        const state = analytics_model_1.valuationStateSchema.parse(req.body);
        res.json(analytics_service_1.analyticsService.computeValuation(state));
    },
    valuationExitPlan(req, res) {
        const body = analytics_model_1.valuationExitPlanSchema.parse(req.body);
        res.json(analytics_service_1.analyticsService.computeValuationExitPlan(body));
    },
    // M&A Acquisition Modeller (buy-side, DentaCFO Phase 3) — pure compute.
    acquisition(req, res) {
        const body = analytics_model_1.acquisitionSchema.parse(req.body);
        res.json(analytics_service_1.analyticsService.computeAcquisition(body));
    },

    // ── Phase 3 / T12 — persisted config ────────────────────────────────────
    // Saved valuation drivers. GET = valuation.view; PUT = valuation.edit (route
    // gates), audited. GET returns null when never configured (UI seeds itself).
    async getValuationInputs(req, res) {
        res.json(await analytics_service_1.analyticsService.getValuationInputs(req.user.organisation_id));
    },
    async putValuationInputs(req, res) {
        const state = analytics_model_1.valuationInputsSchema.parse(req.body);
        res.json(await analytics_service_1.analyticsService.saveValuationInputs(req.user.organisation_id, state, req.user.id));
    },
    // Saved surgery-capacity config (merged over CHAIR_CONFIG defaults).
    // GET = finance.view; PUT = finance.edit.
    async getChairConfig(req, res) {
        res.json(await analytics_service_1.analyticsService.getChairConfig(req.user.organisation_id));
    },
    async putChairConfig(req, res) {
        const cfg = analytics_model_1.chairConfigSchema.parse(req.body);
        res.json(await analytics_service_1.analyticsService.saveChairConfig(req.user.organisation_id, cfg, req.user.id));
    },

    // ── Phase 3 / T13 — editable P&L scenario sheets ────────────────────────
    // Scenario overlay only (never feeds actuals). GET = finance.view; mutations
    // = finance.edit (route gates), audited automatically (non-/compute/ path).
    async listPlSheets(req, res) {
        res.json(await analytics_service_1.analyticsService.listPlSheets(req.user.organisation_id));
    },
    async getPlSheet(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const sheet = await analytics_service_1.analyticsService.getPlSheet(req.user.organisation_id, id);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        res.json(sheet);
    },
    async createPlSheet(req, res) {
        const fields = analytics_model_1.plSheetCreateSchema.parse(req.body);
        res.status(201).json(await analytics_service_1.analyticsService.createPlSheet(req.user.organisation_id, fields, req.user.id));
    },
    async updatePlSheet(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const fields = analytics_model_1.plSheetUpdateSchema.parse(req.body);
        const sheet = await analytics_service_1.analyticsService.updatePlSheet(req.user.organisation_id, id, fields, req.user.id);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        res.json(sheet);
    },
    async deletePlSheet(req, res) {
        const { id } = idParamSchema.parse(req.params);
        await analytics_service_1.analyticsService.deletePlSheet(req.user.organisation_id, id);
        res.status(204).end();
    },
    // CSV export of a saved sheet (£ from integer pence). finance.view.
    async exportPlSheetCsv(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const sheet = await analytics_service_1.analyticsService.getPlSheet(req.user.organisation_id, id);
        if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
        const { filename, csv } = analytics_service_1.analyticsService.plSheetToCsv(sheet);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    },
    // ---- Board Report Generator (DentaCFO Phase 2) ----
    // Generate the pack (token cost; POST so it's never run on page load).
    async boardReport(req, res) {
        const { since, until, label } = analytics_model_1.boardReportSchema.parse(req.body ?? {});
        res.json(await analytics_service_1.analyticsService.boardReport(req.user.organisation_id, { since, until, label }));
    },
    // Generate + email now to one address. {sent:false} (not an error) when SES
    // is unconfigured — the UI falls back to a mailto draft.
    async emailBoardReport(req, res) {
        const { recipient_email, since, until, label } = analytics_model_1.boardReportEmailSchema.parse(req.body ?? {});
        res.json(await analytics_service_1.analyticsService.emailBoardReport(req.user.organisation_id, { recipientEmail: recipient_email, since, until, label }));
    },
    async listBoardSchedules(req, res) {
        res.json(await analytics_service_1.analyticsService.listBoardSchedules(req.user.organisation_id));
    },
    async createBoardSchedule(req, res) {
        const fields = analytics_model_1.boardScheduleCreateSchema.parse(req.body ?? {});
        res.status(201).json(await analytics_service_1.analyticsService.createBoardSchedule(req.user.organisation_id, fields, req.user.id));
    },
    async updateBoardSchedule(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const fields = analytics_model_1.boardScheduleUpdateSchema.parse(req.body ?? {});
        const row = await analytics_service_1.analyticsService.updateBoardSchedule(req.user.organisation_id, id, fields);
        if (!row) return res.status(404).json({ error: 'Schedule not found' });
        res.json(row);
    },
    async deleteBoardSchedule(req, res) {
        const { id } = idParamSchema.parse(req.params);
        await analytics_service_1.analyticsService.deleteBoardSchedule(req.user.organisation_id, id);
        res.status(204).end();
    },
};
