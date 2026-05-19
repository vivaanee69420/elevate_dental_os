import * as workflow_service_1 from "../services/workflow.service.js";
import * as workflow_model_1 from "../models/workflow.model.js";
export const workflowController = {
    async list(req, res) {
        res.json(await workflow_service_1.workflowService.list(req.user.organisation_id));
    },
    async create(req, res) {
        const body = workflow_model_1.workflowCreateSchema.parse(req.body);
        res.json(await workflow_service_1.workflowService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        res.json(await workflow_service_1.workflowService.update(req.user.organisation_id, req.params.id, req.body));
    },
    async remove(req, res) {
        res.json(await workflow_service_1.workflowService.remove(req.user.organisation_id, req.params.id));
    },
};
