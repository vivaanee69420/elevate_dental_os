"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipController = void 0;
const membership_service_1 = require("../services/membership.service");
const membership_model_1 = require("../models/membership.model");
exports.membershipController = {
    async listPlans(req, res) {
        res.json(await membership_service_1.membershipService.listPlans(req.user.organisation_id));
    },
    async list(req, res) {
        res.json(await membership_service_1.membershipService.list(req.user.organisation_id));
    },
    async create(req, res) {
        const body = membership_model_1.membershipCreateSchema.parse(req.body);
        res.json(await membership_service_1.membershipService.create(req.user.organisation_id, body));
    },
};
