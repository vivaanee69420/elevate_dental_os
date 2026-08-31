import {
  platformLoginSchema,
  platformChangePasswordSchema,
  listOrgsQuerySchema,
  orgIdParamSchema,
  userSearchQuerySchema,
  auditQuerySchema,
  metricsRangeQuerySchema,
  createOrgSchema,
  userIdParamSchema,
  agencyAdminBodySchema,
} from '../models/platform-admin.model.js';
import { platformAdminService } from '../services/platform-admin.service.js';

export const platformAdminController = {
  async login(req, res) {
    const body = platformLoginSchema.parse(req.body);
    const out = await platformAdminService.login(body, req);
    res.json(out);
  },

  async changePassword(req, res) {
    const body = platformChangePasswordSchema.parse(req.body);
    const out = await platformAdminService.changePassword(req.platformAdmin, body, req);
    res.json(out);
  },

  async me(req, res) {
    const out = await platformAdminService.me(req.platformAdmin);
    res.json(out);
  },

  async listOrgs(req, res) {
    const q = listOrgsQuerySchema.parse(req.query);
    const out = await platformAdminService.listOrgs(req.platformAdmin, q, req);
    res.json(out);
  },

  async createOrg(req, res) {
    const body = createOrgSchema.parse(req.body);
    const out = await platformAdminService.createOrg(req.platformAdmin, body, req);
    res.status(201).json(out);
  },

  async listSignups(req, res) {
    const out = await platformAdminService.listSignups(req.platformAdmin, req);
    res.json(out);
  },

  async approveSignup(req, res) {
    const { id } = userIdParamSchema.parse(req.params);
    const out = await platformAdminService.approveSignup(req.platformAdmin, id, req);
    res.json(out);
  },

  async rejectSignup(req, res) {
    const { id } = userIdParamSchema.parse(req.params);
    const out = await platformAdminService.rejectSignup(req.platformAdmin, id, req);
    res.json(out);
  },

  async getOrg(req, res) {
    const { id } = orgIdParamSchema.parse(req.params);
    const out = await platformAdminService.getOrg(req.platformAdmin, id, req);
    res.json(out);
  },

  async getOrgUsers(req, res) {
    const { id } = orgIdParamSchema.parse(req.params);
    const out = await platformAdminService.getOrgUsers(req.platformAdmin, id, req);
    res.json(out);
  },

  async getOrgActivity(req, res) {
    const { id } = orgIdParamSchema.parse(req.params);
    const out = await platformAdminService.getOrgActivity(req.platformAdmin, id, req);
    res.json(out);
  },

  async searchUsers(req, res) {
    const q = userSearchQuerySchema.parse(req.query);
    const out = await platformAdminService.searchUsers(req.platformAdmin, q, req);
    res.json(out);
  },

  async setAgencyAdmin(req, res) {
    const { id } = userIdParamSchema.parse(req.params);
    const { enabled } = agencyAdminBodySchema.parse(req.body);
    res.json(await platformAdminService.setAgencyAdmin(req.platformAdmin, id, enabled, req));
  },

  async overview(req, res) {
    const q = metricsRangeQuerySchema.parse(req.query);
    const out = await platformAdminService.overview(req.platformAdmin, q, req);
    res.json(out);
  },

  async integrations(req, res) {
    const out = await platformAdminService.integrations(req.platformAdmin, req);
    res.json(out);
  },

  async auditCrossOrg(req, res) {
    const q = auditQuerySchema.parse(req.query);
    const out = await platformAdminService.auditCrossOrg(req.platformAdmin, q, req);
    res.json(out);
  },

  async auditPlatform(req, res) {
    const q = auditQuerySchema.parse(req.query);
    const out = await platformAdminService.auditPlatform(req.platformAdmin, q, req);
    res.json(out);
  },
};
