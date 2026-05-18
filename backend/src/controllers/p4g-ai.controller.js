"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.p4gAiController = void 0;
const p4g_ai_service_1 = require("../services/p4g-ai.service");
const p4g_ai_model_1 = require("../models/p4g-ai.model");
exports.p4gAiController = {
    async chat(req, res) {
        const body = p4g_ai_model_1.p4gChatSchema.parse(req.body);
        res.json(await p4g_ai_service_1.p4gAiService.chat(req.user.organisation_id, body));
    },
};
