import * as analytics_service_1 from "../services/analytics.service.js";
import * as analytics_model_1 from "../models/analytics.model.js";
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
        const practiceId = req.query.practice_id || undefined;
        res.json(await analytics_service_1.analyticsService.pl(req.user.organisation_id, { practiceId }));
    },
    async plBenchmark(req, res) {
        const practiceId = req.query.practice_id || undefined;
        res.json(await analytics_service_1.analyticsService.plBenchmark(req.user.organisation_id, { practiceId }));
    },
    // P&L & Margin (Intelligence OS) — scope/period-aware group statement +
    // per-entity P&L from real monthly_financials actuals.
    async plMargin(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.plMargin(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
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
        res.json(await analytics_service_1.analyticsService.businessHub(req.user.organisation_id, { days }));
    },
    async chair(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        const recoverPctPoints = Math.max(0, Math.min(40, Number(req.query.recover) || 10));
        res.json(await analytics_service_1.analyticsService.chairAnalytics(req.user.organisation_id, { scope: q.scope, recoverPctPoints }));
    },
    // Treatment Mix heat matrix (GM Intelligence OS) — scope/period-driven
    // appointment volume by type x practice. Volume only (no price; data wall).
    async treatmentMatrix(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.treatmentMatrix(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
        }));
    },
    // Treatment REVENUE heat matrix — real invoiced fee by treatment name x
    // practice (from invoice_items). Money in pence. Same shape as the volume
    // matrix so the frontend can toggle Volume/£.
    async treatmentRevenue(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.treatmentRevenueMatrix(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
        }));
    },
    // AI Analyst (GM Intelligence OS) — £-ranked findings over live scope/period
    // data + a natural-language answer (Claude) to a free-text question.
    async aiAsk(req, res) {
        const b = analytics_model_1.aiAskSchema.parse(req.body);
        res.json(await analytics_service_1.analyticsService.aiAsk(req.user.organisation_id, {
            scope: b.scope, period: b.period, periodKey: b.pk, question: b.question,
        }));
    },
    // Clinicians (GM Intelligence OS) — per-clinician production, pay splits and
    // NHS/UDA from real associate roster + treatment_plans + appointment stats.
    async clinicians(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.clinicians(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
        }));
    },
    // Marketing & ROI (GM Intelligence OS) — per-channel acquisition economics
    // from real ad_metrics (spend) + CRM leads (attribution/conversion).
    async marketingRoi(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.marketingRoi(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
        }));
    },
    // Day — Cash Collected (GM Intelligence OS). Real settled receipts banked by
    // working day across the month in scope + a composite collection index.
    async cashByDay(req, res) {
        const q = analytics_model_1.scopeQuerySchema.parse(req.query);
        res.json(await analytics_service_1.analyticsService.cashByDay(req.user.organisation_id, {
            scope: q.scope, period: q.period, periodKey: q.pk,
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
};
