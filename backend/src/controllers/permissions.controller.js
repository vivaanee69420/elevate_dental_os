// ============================================================================
// Permissions controller — dynamic RBAC admin API (idiomatic Express).
// Parse/validate with Zod, call the service, shape the HTTP response.
// Org comes from req.user.organisation_id (never the body) so a request
// can only ever touch its own organisation's matrix.
// ============================================================================

import { z } from 'zod';
import { permissionsService } from '../services/permissions.service.js';

const roleDefaultSchema = z.object({
  role: z.enum(['owner', 'practice_manager', 'reception']),
  permission_key: z.string().min(1),
  allowed: z.boolean(),
});

const userOverrideSchema = z.object({
  user_id: z.string().uuid(),
  permission_key: z.string().min(1),
  // null clears the override (fall back to the role default).
  allowed: z.boolean().nullable(),
});

const permissionsController = {
  // GET /api/admin/permissions — full matrix for the Team Permissions UI.
  async getMatrix(req, res) {
    res.json(await permissionsService.getMatrix(req.user.organisation_id));
  },

  // PUT /api/admin/permissions/role — set a role's default for one key.
  async setRoleDefault(req, res) {
    const body = roleDefaultSchema.parse(req.body);
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
