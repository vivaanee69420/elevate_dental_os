import * as file_service_1 from "../services/file.service.js";
import * as file_model_1 from "../models/file.model.js";
export const fileController = {
    async presign(req, res) {
        const body = file_model_1.filePresignSchema.parse(req.body);
        res.json(await file_service_1.fileService.presign(req.user.organisation_id, req.user.id, body));
    },
    async list(req, res) {
        res.json(await file_service_1.fileService.list(req.user.organisation_id));
    },
};
