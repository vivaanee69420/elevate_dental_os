import * as contact_service_1 from "../services/contact.service.js";
import * as contact_model_1 from "../models/contact.model.js";
import { idParamSchema } from "../models/common.model.js";
export const contactController = {
    async list(req, res) {
        const q = contact_model_1.contactListQuerySchema.parse(req.query);
        const r = await contact_service_1.contactService.list(req.user.organisation_id, q);
        res.json({ contacts: r.rows, total: r.total, page: r.page, limit: r.limit });
    },
    async getById(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const data = await contact_service_1.contactService.getById(req.user.organisation_id, id);
        res.json(data);
    },
    async create(req, res) {
        const body = contact_model_1.contactCreateSchema.parse(req.body);
        res.json(await contact_service_1.contactService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = contact_model_1.contactUpdateSchema.parse(req.body);
        res.json(await contact_service_1.contactService.update(req.user.organisation_id, id, body));
    },
};
