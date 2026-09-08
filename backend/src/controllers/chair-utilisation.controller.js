import { chairUtilisationService } from "../services/chair-utilisation.service.js";
import {
    chairUtilisationListQuerySchema,
    chairPracticeQuerySchema,
    chairWeekSaveSchema,
    practiceChairCreateSchema,
    practiceChairUpdateSchema,
    openingHoursSaveSchema,
} from "../models/chair-utilisation.model.js";
import { idParamSchema } from "../models/common.model.js";

// The organisation is ALWAYS req.user.organisation_id. It never comes from a
// body, a query parameter or a payload row — every schema below is .strict(),
// so a caller cannot smuggle one in either.
export const chairUtilisationController = {
    async list(req, res) {
        const q = chairUtilisationListQuerySchema.parse(req.query);
        const records = await chairUtilisationService.list(req.user.organisation_id, q.practice_id);
        res.json({ records });
    },
    async grid(req, res) {
        const q = chairUtilisationListQuerySchema.parse(req.query);
        const grid = await chairUtilisationService.grid(req.user.organisation_id, q.practice_id, { asOf: q.asOf });
        res.json(grid);
    },

    async week(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.week(req.user.organisation_id, q.practice_id));
    },
    async saveWeek(req, res) {
        const body = chairWeekSaveSchema.parse(req.body);
        res.json(await chairUtilisationService.saveWeek(req.user.organisation_id, body));
    },

    async listChairs(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.listChairs(req.user.organisation_id, q.practice_id));
    },
    async createChair(req, res) {
        const body = practiceChairCreateSchema.parse(req.body);
        res.status(201).json(await chairUtilisationService.createChair(req.user.organisation_id, body));
    },
    async updateChair(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = practiceChairUpdateSchema.parse(req.body);
        res.json(await chairUtilisationService.updateChair(req.user.organisation_id, id, body));
    },
    async removeChair(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await chairUtilisationService.removeChair(req.user.organisation_id, id));
    },

    async openingHours(req, res) {
        const q = chairPracticeQuerySchema.parse(req.query);
        res.json(await chairUtilisationService.listOpeningHours(req.user.organisation_id, q.practice_id));
    },
    async saveOpeningHours(req, res) {
        const body = openingHoursSaveSchema.parse(req.body);
        res.json(await chairUtilisationService.saveOpeningHours(req.user.organisation_id, body));
    },
};
