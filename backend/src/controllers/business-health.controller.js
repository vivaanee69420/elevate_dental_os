import * as business_health_service_1 from "../services/business-health.service.js";
import * as business_health_model_1 from "../models/business-health.model.js";
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
        res.json(await business_health_service_1.businessHealthService.progress(req.user.organisation_id));
    },
};
