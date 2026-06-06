import { chairUtilisationService } from "../services/chair-utilisation.service.js";
import {
    chairUtilisationListQuerySchema,
    chairUtilisationCreateSchema,
    chairUtilisationUpdateSchema,
} from "../models/chair-utilisation.model.js";
import { idParamSchema } from "../models/common.model.js";

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
    async create(req, res) {
        const body = chairUtilisationCreateSchema.parse(req.body);
        res.status(201).json(await chairUtilisationService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = chairUtilisationUpdateSchema.parse(req.body);
        res.json(await chairUtilisationService.update(req.user.organisation_id, id, body));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await chairUtilisationService.remove(req.user.organisation_id, id));
    },
};
