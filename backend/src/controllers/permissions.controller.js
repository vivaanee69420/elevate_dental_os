// ============================================================================
// Permissions controller — dynamic RBAC admin API (idiomatic Express).
// Parse/validate with Zod, call the service, shape the HTTP response.
// Org comes from req.user.organisation_id (never the body) so a request
// can only ever touch its own organisation's matrix.
// ============================================================================

import { z } from 'zod';
import { permissionsService } from '../services/permissions.service.js';
import { ROLES } from '../lib/permissions.js';
import { AppError } from '../middleware/errors.js';

const roleDefaultSchema = z.object({
  role: z.enum(ROLES),
  permission_key: z.string().min(1),
  // null clears the row (inherit) — used to reset a page override back to its
  // section. false is an explicit deny and is NOT the same thing.
  allowed: z.boolean().nullable(),
});

const userOverrideSchema = z.object({
  user_id: z.string().uuid(),
  permission_key: z.string().min(1),
  // null clears the override (fall back to the role default).
  allowed: z.boolean().nullable(),
});

// The three rules the Team screen enforces, applied here too — this is the
// OTHER door into the same data, and a rule that only one door honours is
// not a rule. Editing the owner row of the matrix, or your own override, is
// granting yourself; a key you do not hold is not yours to hand out.
//
// isAgencyActor is resolved server-side in authenticate (req.agencyOrgId is
// only set for a real agency admin), never taken from the request.
function assertMayGrant(req, { role, userId, permissionKey }) {
  const caller = req.user;
  const isAgencyActor = Boolean(req.agencyOrgId);
  if (!isAgencyActor) {
    if (role === 'owner') {
      throw new AppError('Only an agency administrator can change what an owner may do', 403);
    }
    if (userId && userId === caller.id) {
      throw new AppError('You cannot change your own permissions', 403);
    }
  }
  // You cannot hand out what you do not hold — including as an owner, whose
  // grant ceiling is otherwise unbounded. An agency actor administering a
  // sub-account is exempt: that is the role that exists to set these.
  if (!isAgencyActor && caller.permissions?.[permissionKey] !== true) {
    throw new AppError(`You cannot grant a permission you do not hold: ${permissionKey}`, 403);
  }
}

const permissionsController = {
  // GET /api/admin/permissions — full matrix for the Team Permissions UI.
  async getMatrix(req, res) {
    res.json(await permissionsService.getMatrix(req.user.organisation_id));
  },

  // PUT /api/admin/permissions/role — set a role's default for one key.
  async setRoleDefault(req, res) {
    const body = roleDefaultSchema.parse(req.body);
    assertMayGrant(req, { role: body.role, permissionKey: body.permission_key });
    res.json(
      await permissionsService.setRoleDefault(
        req.user.organisation_id,
        body.role,
        body.permission_key,
        body.allowed,
      ),
    );
  },

  // PUT /api/admin/permissions/user — set/clear a per-user override.
  async setUserOverride(req, res) {
    const body = userOverrideSchema.parse(req.body);
    assertMayGrant(req, { userId: body.user_id, permissionKey: body.permission_key });
    res.json(
      await permissionsService.setUserOverride(
        req.user.organisation_id,
        body.user_id,
        body.permission_key,
        body.allowed,
      ),
    );
  },
};

export { permissionsController };
