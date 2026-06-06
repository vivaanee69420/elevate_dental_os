import * as business_health_service_1 from "../services/business-health.service.js";
import * as business_health_model_1 from "../models/business-health.model.js";
// As-of period filter: accept a YYYY-MM-DD query param, ignore anything else.
const parseAsOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const businessHealthController = {
    async get(req, res) {
        res.json(await business_health_service_1.businessHealthService.get(req.user.organisation_id, req.user.role));
    },
    async update(req, res) {
        const body = business_health_model_1.businessHealthUpdateSchema.parse(req.body);
        res.json(await business_health_service_1.businessHealthService.update(req.user.organisation_id, req.user.role, body));
    },
    async insights(req, res) {
        res.json(await business_health_service_1.businessHealthService.insights(req.user.organisation_id, req.user.role));
    },
    async listSnapshots(req, res) {
        res.json(await business_health_service_1.businessHealthService.listSnapshots(req.user.organisation_id));
    },
    async createSnapshot(req, res) {
        const body = business_health_model_1.snapshotCreateSchema.parse(req.body);
        res.json(await business_health_service_1.businessHealthService.createSnapshot(req.user.organisation_id, req.user.role, body));
    },
    async progress(req, res) {
        const asOf = parseAsOf(req.query.asOf);
        res.json(await business_health_service_1.businessHealthService.progress(req.user.organisation_id, { asOf }));
    },
    async metrics(req, res) {
        const asOf = parseAsOf(req.query.asOf);
        res.json(await business_health_service_1.businessHealthService.metrics(req.user.organisation_id, req.user.role, { asOf }));
    },
    async updateMetric(req, res) {
        const { value } = business_health_model_1.manualMetricSchema.parse(req.body);
        res.json(await business_health_service_1.businessHealthService.updateMetric(req.user.organisation_id, req.user.role, req.params.key, value));
    },
    async updateCadence(req, res) {
        const body = business_health_model_1.cadenceUpdateSchema.parse(req.body);
        res.json(await business_health_service_1.businessHealthService.updateCadence(req.user.organisation_id, req.user.role, body));
    },
};
