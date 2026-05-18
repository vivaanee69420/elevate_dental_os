"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactController = void 0;
const contact_service_1 = require("../services/contact.service");
const contact_model_1 = require("../models/contact.model");
exports.contactController = {
    async list(req, res) {
        const q = contact_model_1.contactListQuerySchema.parse(req.query);
        const contacts = await contact_service_1.contactService.list(req.user.organisation_id, q);
        res.json({ contacts });
    },
    async getById(req, res) {
        const data = await contact_service_1.contactService.getById(req.user.organisation_id, req.params.id);
        res.json(data);
    },
    async create(req, res) {
        const body = contact_model_1.contactCreateSchema.parse(req.body);
        res.json(await contact_service_1.contactService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = contact_model_1.contactUpdateSchema.parse(req.body);
        res.json(await contact_service_1.contactService.update(req.user.organisation_id, req.params.id, body));
    },
};
