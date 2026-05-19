// ============================================================================
// Review service — business logic for the reviews domain.
// ============================================================================
import * as review_repository_1 from "../repositories/review.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const reviewService = {
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
