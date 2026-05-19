import * as review_service_1 from "../services/review.service.js";
import * as review_model_1 from "../models/review.model.js";
export const reviewController = {
    async list(req, res) {
        res.json(await review_service_1.reviewService.list(req.user.organisation_id));
    },
    async respond(req, res) {
        const body = review_model_1.reviewRespondSchema.parse(req.body);
        res.json(await review_service_1.reviewService.respond(req.user.organisation_id, req.params.id, body));
    },
};
