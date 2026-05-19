// ============================================================================
// Permissions service — business logic for dynamic RBAC.
//
//   getEffectiveForUser   : (org, role, userOverrides) -> { key: bool }
//                           used by auth middleware on every request (P1:
//                           one indexed query via listByOrgRole).
//   getMatrix             : full admin view (role_permissions + catalog)
//   setRoleDefault        : owner edits a role's default for a key
//   setUserOverride       : owner sets/clears a per-user override
//
// Org isolation: every call takes orgId and the repository pins it on every
// query. RLS is still the hard floor; this never crosses orgs.
// ============================================================================

import { permissionsRepository } from '../repositories/permissions.repository.js';
import {
  PERMISSION_CATALOG,
  isValidPermission,
  resolveEffectivePermissions,
} from '../lib/permissions.js';
import { AppError } from '../middleware/errors.js';

const permissionsService = {
  /** Effective permission map for a request's user. Pure merge over 1 query. */
  async getEffectiveForUser(orgId, role, userOverrides) {
    const rows = await permissionsRepository.listByOrgRole(orgId, role);
    return resolveEffectivePermissions(rows, userOverrides);
  },

  /**
   * Admin matrix: catalog (labels) + current role defaults, shaped for the
   * Team Permissions UI. { catalog, roles: { role: { key: bool } } }.
   */
  async getMatrix(orgId) {
    const rows = await permissionsRepository.listByOrg(orgId);
    const roles = { owner: {}, practice_manager: {}, reception: {} };
    for (const role of Object.keys(roles)) {
      for (const key of Object.keys(PERMISSION_CATALOG)) roles[role][key] = false;
    }
    for (const r of rows) {
      if (roles[r.role] && isValidPermission(r.permission_key)) {
        roles[r.role][r.permission_key] = !!r.allowed;
      }
    }
    return { catalog: PERMISSION_CATALOG, roles };
  },

  /** Owner sets a role's default for one permission key. */
  async setRoleDefault(orgId, role, permissionKey, allowed) {
    if (!['owner', 'practice_manager', 'reception'].includes(role)) {
      throw new AppError('Unknown role', 400);
    }
    if (!isValidPermission(permissionKey)) {
      throw new AppError(`Unknown permission: ${permissionKey}`, 400);
    }
    await permissionsRepository.setRolePermission(orgId, role, permissionKey, !!allowed);
    return { success: true };
  },

  /**
   * Owner sets or clears a per-user override. `allowed === null` removes the
   * override (user falls back to their role default).
   */
  async setUserOverride(orgId, userId, permissionKey, allowed) {
    if (!isValidPermission(permissionKey)) {
      throw new AppError(`Unknown permission: ${permissionKey}`, 400);
    }
    const user = await permissionsRepository.getUser(orgId, userId);
    if (!user) throw new AppError('User not found in organisation', 404);
    const overrides = { ...(user.permissions || {}) };
    if (allowed === null) {
      delete overrides[permissionKey];
    } else {
      overrides[permissionKey] = !!allowed;
    }
    await permissionsRepository.setUserOverrides(orgId, userId, overrides);
    return { success: true, permissions: overrides };
  },
};

export { permissionsService };
