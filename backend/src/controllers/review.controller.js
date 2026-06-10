import * as review_service_1 from "../services/review.service.js";
import * as review_model_1 from "../models/review.model.js";
import { idParamSchema } from "../models/common.model.js";

export const reviewController = {
    async list(req, res) {
        const { source, practice_id } = review_model_1.reviewListQuerySchema.parse(req.query);
        res.json(await review_service_1.reviewService.list(req.user.organisation_id, {
            source,
            practiceId: practice_id,
        }));
    },
    async respond(req, res) {
        const body = review_model_1.reviewRespondSchema.parse(req.body);
        res.json(await review_service_1.reviewService.respond(req.user.organisation_id, req.params.id, body));
    },

    // ---- Source management (the review "accounts") ------------------------
    async sources(req, res) {
        res.json(await review_service_1.reviewService.sources(req.user.organisation_id));
    },
    async search(req, res) {
        const { provider, q } = review_model_1.reviewSearchSchema.parse({ ...req.query, ...req.body });
        res.json(await review_service_1.reviewService.searchSources(req.user.organisation_id, provider, q));
    },
    async addSource(req, res) {
        const body = review_model_1.reviewSourceCreateSchema.parse(req.body);
        res.json(await review_service_1.reviewService.addSource(req.user.organisation_id, body));
    },
    async removeSource(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await review_service_1.reviewService.removeSource(req.user.organisation_id, id));
    },
    async setSourcePractice(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const { practice_id } = review_model_1.reviewSourcePracticeSchema.parse(req.body);
        res.json(await review_service_1.reviewService.setSourcePractice(req.user.organisation_id, id, practice_id));
    },
    async setSelection(req, res) {
        const { selected_ids } = review_model_1.reviewSourceSelectionSchema.parse(req.body);
        res.json(await review_service_1.reviewService.setSelection(req.user.organisation_id, selected_ids));
    },

    // ---- Sync -------------------------------------------------------------
    async sync(req, res) {
        const { organisation_id } = req.user;
        review_service_1.reviewService.syncNow(organisation_id)
            .catch((err) => console.error('[reviews] sync failed:', err?.message || err));
        res.json({ started: true });
    },
    async syncProgress(req, res) {
        res.json(review_service_1.reviewService.syncProgress(req.user.organisation_id));
    },
};
