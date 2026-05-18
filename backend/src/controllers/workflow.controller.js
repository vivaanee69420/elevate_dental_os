"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowController = void 0;
const workflow_service_1 = require("../services/workflow.service");
const workflow_model_1 = require("../models/workflow.model");
exports.workflowController = {
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
