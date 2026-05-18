"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewService = void 0;
// ============================================================================
// Review service — business logic for the reviews domain.
// ============================================================================
const review_repository_1 = require("../repositories/review.repository");
const errors_1 = require("../middleware/errors");
exports.reviewService = {
    async list(orgId) {
        const data = await review_repository_1.reviewRepository.list(orgId);
        return { reviews: data || [] };
    },
    async respond(orgId, id, input) {
        const { data, error } = await review_repository_1.reviewRepository.respond(orgId, id, {
            response_body: input.response,
            responded_at: new Date().toISOString(),
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
};
