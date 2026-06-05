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
};
