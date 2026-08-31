// Agency menu controllers — parse/validate, call agencyService, shape the
// response. Handlers act on the caller's HOME org (agencyHomeOrgId) so the
// menu keeps working while switched into a child.
import * as zod_1 from "zod";
import { agencyService } from "../services/agency.service.js";
import {
    createSubaccountSchema, switchSchema, featureToggleSchema,
    subaccountUserSchema, deleteSubaccountSchema,
} from "../models/agency.model.js";
import { agencyHomeOrgId } from "../middleware/agency.js";

const idParam = zod_1.z.object({ id: zod_1.z.string().uuid() });

export const agencyController = {
    async list(req, res) {
        res.json(await agencyService.listSubaccounts(agencyHomeOrgId(req)));
    },
    async create(req, res) {
        const body = createSubaccountSchema.parse(req.body);
        res.status(201).json(await agencyService.createSubaccount(agencyHomeOrgId(req), body));
    },
    async features(req, res) {
        const { id } = idParam.parse(req.params);
        res.json(await agencyService.subaccountFeatures(agencyHomeOrgId(req), id));
    },
    async setFeature(req, res) {
        const { id } = idParam.parse(req.params);
        const body = featureToggleSchema.parse(req.body);
        res.json(await agencyService.setSubaccountFeature(agencyHomeOrgId(req), id, body));
    },
    async listUsers(req, res) {
        const { id } = idParam.parse(req.params);
        res.json(await agencyService.listSubaccountUsers(agencyHomeOrgId(req), id));
    },
    async addUser(req, res) {
        const { id } = idParam.parse(req.params);
        const body = subaccountUserSchema.parse(req.body);
        res.status(201).json(
            await agencyService.addSubaccountUser(agencyHomeOrgId(req), id, req.user, body),
        );
    },
    async remove(req, res) {
        const { id } = idParam.parse(req.params);
        const { confirm_name } = deleteSubaccountSchema.parse(req.body);
        res.json(await agencyService.deleteSubaccount(agencyHomeOrgId(req), id, confirm_name));
    },
    async switch(req, res) {
        const { orgId } = switchSchema.parse(req.body);
        res.json(await agencyService.switch(agencyHomeOrgId(req), req.user.id, orgId));
    },
};
