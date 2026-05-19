// ============================================================================
// Members controller — Team admin (idiomatic ESM).
// Owner-managed team provisioning: list, invite (-> 'invited'), remove
// (deletes public.users AND the Supabase auth identity). Org is always
// req.user.organisation_id; a request can only touch its own org.
// ============================================================================

import { authService } from "../services/auth.service.js";
import { inviteSchema, removeMemberSchema } from "../models/auth.model.js";

export const membersController = {
  // GET /api/admin/team — members of the caller's org.
  async list(req, res) {
    res.json(await authService.listMembers(req.user.organisation_id));
  },

  // POST /api/admin/team/invite — add a member (email, full_name, role,
  // optional permissions). Sends the Supabase invite; row starts 'invited'.
  async invite(req, res) {
    const body = inviteSchema.parse(req.body);
    res.json(await authService.invite(req.user.organisation_id, body));
  },

  // POST /api/admin/team/remove — fully remove a member (cannot remove self).
  async remove(req, res) {
    const body = removeMemberSchema.parse(req.body);
    res.json(
      await authService.removeMember(
        req.user.organisation_id,
        req.user.id,
        body.user_id,
      ),
    );
  },
};
