import * as p4g_ai_service_1 from "../services/p4g-ai.service.js";
import * as p4g_ai_model_1 from "../models/p4g-ai.model.js";
export const p4gAiController = {
    async chat(req, res) {
        const body = p4g_ai_model_1.p4gChatSchema.parse(req.body);
        res.json(await p4g_ai_service_1.p4gAiService.chat(req.user.organisation_id, body));
    },
};
