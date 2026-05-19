import * as analytics_service_1 from "../services/analytics.service.js";
export const analyticsController = {
    async dashboard(req, res) {
        res.json(await analytics_service_1.analyticsService.dashboard(req.user.organisation_id));
    },
    async pl(req, res) {
        res.json(await analytics_service_1.analyticsService.pl(req.user.organisation_id));
    },
    async valuation(req, res) {
        res.json(await analytics_service_1.analyticsService.valuation(req.user.organisation_id));
    },
    async kpis(req, res) {
        res.json(await analytics_service_1.analyticsService.kpis(req.user.organisation_id));
    },
};
