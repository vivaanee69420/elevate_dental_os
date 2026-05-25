// ============================================================================
// Platform-admin service — business logic. Every cross-tenant action is
// awaited-audit-logged BEFORE returning. If audit insert fails the caller
// gets a 500 (fail-closed).
// ============================================================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { platformAdminRepository } from '../repositories/platform-admin.repository.js';
import { provisionOrgOwner } from './auth.service.js';

const JWT_ISSUER = 'elevate-platform';
const JWT_EXPIRES = '8h';

// One-time handover credential for a platform-created owner. 16 URL-safe
// chars (~96 bits); the owner changes it in account settings after login.
function generateTempPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function getSecret() {
  const s = process.env.PLATFORM_ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new AppError('PLATFORM_ADMIN_JWT_SECRET missing or too short', 500);
  }
  return s;
}

function signToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role, typ: 'platform' },
    getSecret(),
    { issuer: JWT_ISSUER, expiresIn: JWT_EXPIRES },
  );
}

async function audit(admin, action, { orgId, userId, payload, req } = {}) {
  await platformAdminRepository.insertAudit({
    platform_admin_id: admin.id,
    action,
    target_organisation_id: orgId ?? null,
    target_user_id: userId ?? null,
    ip_address: req?.platformIp ?? null,
    user_agent: req?.platformUserAgent ?? null,
    payload: payload ?? {},
  });
}

export const platformAdminService = {
  signToken,
  audit,

  async login({ email, password }, req) {
    const admin = await platformAdminRepository.findByEmail(email);
    if (!admin) throw new AppError('Invalid credentials', 401);

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) throw new AppError('Invalid credentials', 401);

    await platformAdminRepository.updateLastLogin(admin.id);
    await audit(admin, 'login', { req, payload: { email } });

    return {
      token: signToken(admin),
      admin: {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        role: admin.role,
        must_change_password: admin.must_change_password,
      },
    };
  },

  async changePassword(admin, { current_password, new_password }, req) {
    const full = await platformAdminRepository.findByEmail(admin.email);
    if (!full) throw new AppError('Admin not found', 404);

    const ok = await bcrypt.compare(current_password, full.password_hash);
    if (!ok) throw new AppError('Current password incorrect', 401);

    const password_hash = await bcrypt.hash(new_password, 12);
    await platformAdminRepository.setPassword(admin.id, password_hash);
    await audit(admin, 'change_password', { req });
    return { ok: true };
  },

  async me(admin) {
    const row = await platformAdminRepository.findById(admin.id);
    if (!row) throw new AppError('Admin not found', 404);
    return row;
  },

  async listOrgs(admin, query, req) {
    const result = await platformAdminRepository.listOrgs(query);
    await audit(admin, 'list_orgs', { req, payload: { q: query.q, count: result.rows.length } });
    return result;
  },

  // Platform admin creates a tenant org + owner DIRECTLY (auto-approved).
  // The owner is 'active' immediately and can log in with the returned
  // temp password, which is surfaced ONCE here and never persisted/audited.
  async createOrg(admin, body, req) {
    const password = generateTempPassword();
    const { organisation_id, owner_id } = await provisionOrgOwner(
      { ...body, password },
      'active',
    );
    await audit(admin, 'create_org', {
      req,
      orgId: organisation_id,
      userId: owner_id,
      // NB: temp password intentionally excluded from the audit payload.
      payload: { email: body.email, organisation_name: body.organisation_name },
    });
    return { organisation_id, owner_id, email: body.email, temp_password: password };
  },

  // Owners awaiting approval (self-signup queue).
  async listSignups(admin, req) {
    const rows = await platformAdminRepository.listPendingSignups();
    await audit(admin, 'list_signups', { req, payload: { count: rows.length } });
    return rows;
  },

  // Approve a pending self-signup -> owner becomes 'active' (can log in).
  async approveSignup(admin, userId, req) {
    const owner = await platformAdminRepository.getUserById(userId);
    if (!owner || owner.role !== 'owner') throw new AppError('Signup not found', 404);
    if (owner.status !== 'pending') {
      throw new AppError(`Cannot approve an account in '${owner.status}' state`, 409);
    }
    await platformAdminRepository.setUserStatusById(userId, 'active');
    await audit(admin, 'approve_signup', { req, orgId: owner.organisation_id, userId });
    return { ok: true, status: 'active' };
  },

  // Reject a pending self-signup -> 'rejected' (kept for record; no login).
  async rejectSignup(admin, userId, req) {
    const owner = await platformAdminRepository.getUserById(userId);
    if (!owner || owner.role !== 'owner') throw new AppError('Signup not found', 404);
    if (owner.status !== 'pending') {
      throw new AppError(`Cannot reject an account in '${owner.status}' state`, 409);
    }
    await platformAdminRepository.setUserStatusById(userId, 'rejected');
    await audit(admin, 'reject_signup', { req, orgId: owner.organisation_id, userId });
    return { ok: true, status: 'rejected' };
  },

  async getOrg(admin, id, req) {
    const org = await platformAdminRepository.getOrg(id);
    if (!org) throw new AppError('Organisation not found', 404);
    const users = await platformAdminRepository.countUsersByOrg(id);
    await audit(admin, 'view_org', { req, orgId: id });
    return { ...org, user_count: users };
  },

  async getOrgUsers(admin, id, req) {
    const users = await platformAdminRepository.listOrgUsers(id);
    await audit(admin, 'view_org_users', { req, orgId: id, payload: { count: users.length } });
    return users;
  },

  async getOrgActivity(admin, id, req) {
    const rows = await platformAdminRepository.listOrgActivity(id);
    await audit(admin, 'view_org_activity', { req, orgId: id, payload: { count: rows.length } });
    return rows;
  },

  async searchUsers(admin, { q, limit }, req) {
    const rows = await platformAdminRepository.searchUsers({ q, limit });
    await audit(admin, 'search_users', { req, payload: { q, count: rows.length } });
    return rows;
  },

  async overview(admin, { days }, req) {
    const data = await platformAdminRepository.metricsOverview(days);
    await audit(admin, 'view_metrics_overview', { req, payload: { days } });
    return data;
  },

  async integrations(admin, req) {
    const data = await platformAdminRepository.integrationsHealth();
    await audit(admin, 'view_metrics_integrations', { req });
    return data;
  },

  async auditCrossOrg(admin, query, req) {
    const result = await platformAdminRepository.listAuditCrossOrg(query);
    await audit(admin, 'view_audit', { req, payload: { ...query, count: result.rows.length } });
    return result;
  },

  async auditPlatform(admin, query, req) {
    const rows = await platformAdminRepository.listAudit({ limit: query.limit, offset: query.offset });
    await audit(admin, 'view_platform_audit', { req, payload: { count: rows.length } });
    return rows;
  },
};
