"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewController = void 0;
const review_service_1 = require("../services/review.service");
const review_model_1 = require("../models/review.model");
exports.reviewController = {
    async list(req, res) {
        res.json(await review_service_1.reviewService.list(req.user.organisation_id));
    },
    async respond(req, res) {
        const body = review_model_1.reviewRespondSchema.parse(req.body);
        res.json(await review_service_1.reviewService.respond(req.user.organisation_id, req.params.id, body));
    },
};
