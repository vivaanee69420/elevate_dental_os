"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadController = void 0;
const lead_service_1 = require("../services/lead.service");
const lead_model_1 = require("../models/lead.model");
exports.leadController = {
    async list(req, res) {
        const q = lead_model_1.leadListQuerySchema.parse(req.query);
        const leads = await lead_service_1.leadService.list(req.user.organisation_id, q);
        res.json({ leads });
    },
    async funnel(req, res) {
        res.json(await lead_service_1.leadService.funnel(req.user.organisation_id));
    },
    async getById(req, res) {
        const data = await lead_service_1.leadService.getById(req.user.organisation_id, req.params.id);
        res.json(data);
    },
    async create(req, res) {
        const body = lead_model_1.leadCreateSchema.parse(req.body);
        res.json(await lead_service_1.leadService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = lead_model_1.leadUpdateSchema.parse(req.body);
        res.json(await lead_service_1.leadService.update(req.user.organisation_id, req.params.id, body));
    },
    async remove(req, res) {
        res.json(await lead_service_1.leadService.softDelete(req.user.organisation_id, req.params.id));
    },
};
