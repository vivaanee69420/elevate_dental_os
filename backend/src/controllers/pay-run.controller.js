"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payRunController = void 0;
const pay_run_service_1 = require("../services/pay-run.service");
const pay_run_model_1 = require("../models/pay-run.model");
exports.payRunController = {
    async list(req, res) {
        res.json(await pay_run_service_1.payRunService.list(req.user.organisation_id));
    },
    async calculate(req, res) {
        const body = pay_run_model_1.payRunCalculateSchema.parse(req.body);
        res.json(await pay_run_service_1.payRunService.calculate(req.user.organisation_id, body));
    },
    async approve(req, res) {
        res.json(await pay_run_service_1.payRunService.approve(req.user.organisation_id, req.params.id, req.user.id));
    },
};
