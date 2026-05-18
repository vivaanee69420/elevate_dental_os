"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileService = void 0;
// ============================================================================
// File service — business logic for the files domain.
// ============================================================================
const file_repository_1 = require("../repositories/file.repository");
exports.fileService = {
    async presign(orgId, userId, input) {
        const key = file_repository_1.fileRepository.buildKey(orgId, input.filename);
        const uploadUrl = await file_repository_1.fileRepository.presignUpload(key, input.content_type);
        const file = await file_repository_1.fileRepository.insert({
            organisation_id: orgId,
            uploaded_by: userId,
            filename: input.filename,
            content_type: input.content_type,
            s3_key: key,
            related_entity_type: input.related_entity_type,
            related_entity_id: input.related_entity_id,
        });
        return { uploadUrl, key, file };
    },
    async list(orgId) {
        const data = await file_repository_1.fileRepository.list(orgId);
        return { files: data || [] };
    },
};
