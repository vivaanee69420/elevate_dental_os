// ============================================================================
// CRM settings controller — parse/validate with Zod, call service, shape HTTP.
// ============================================================================
import * as crmSettings_service_1 from "../services/crmSettings.service.js";
import * as crmSettings_model_1 from "../models/crmSettings.model.js";

export const crmSettingsController = {
    async get(req, res) {
        res.json(await crmSettings_service_1.crmSettingsService.get(req.user.organisation_id));
    },
    async update(req, res) {
        const body = crmSettings_model_1.settingsUpdateSchema.parse(req.body);
        res.json(await crmSettings_service_1.crmSettingsService.update(req.user.organisation_id, req.user.id, body));
    },
};
