"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commController = void 0;
const comm_service_1 = require("../services/comm.service");
const comm_model_1 = require("../models/comm.model");
exports.commController = {
    async list(req, res) {
        const q = comm_model_1.commListQuerySchema.parse(req.query);
        const communications = await comm_service_1.commService.list(req.user.organisation_id, q);
        res.json({ communications });
    },
    async send(req, res) {
        const body = comm_model_1.commSendSchema.parse(req.body);
        res.json(await comm_service_1.commService.send(req.user.organisation_id, body, req.log));
    },
};
