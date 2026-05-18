"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileController = void 0;
const file_service_1 = require("../services/file.service");
const file_model_1 = require("../models/file.model");
exports.fileController = {
    async presign(req, res) {
        const body = file_model_1.filePresignSchema.parse(req.body);
        res.json(await file_service_1.fileService.presign(req.user.organisation_id, req.user.id, body));
    },
    async list(req, res) {
        res.json(await file_service_1.fileService.list(req.user.organisation_id));
    },
};
