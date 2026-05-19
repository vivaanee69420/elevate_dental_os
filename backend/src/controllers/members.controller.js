// ============================================================================
// Members controller — Team admin (idiomatic ESM).
// Owner-managed team provisioning: list, invite (-> 'invited'), remove
// (deletes public.users AND the Supabase auth identity). Org is always
// req.user.organisation_id; a request can only touch its own org.
// ============================================================================

import {
  inviteSchema,
  removeMemberSchema,
  provisionMemberSchema,
  setPasswordSchema,
} from "../models/auth.model.js";
import { authService } from "../services/auth.service.js";

export const membersController = {
  // GET /api/admin/team — members of the caller's org.
  async list(req, res) {
    res.json(await authService.listMembers(req.user.organisation_id));
  },

  // POST /api/admin/team/invite — add a member via Supabase invite email
  // (email fallback). Row starts 'invited'.
  async invite(req, res) {
    const body = inviteSchema.parse(req.body);
    res.json(await authService.invite(req.user.organisation_id, req.user, body));
  },

  // POST /api/admin/team/provision — add a member WITH a password; the
  // member is 'active' immediately (primary path, no email).
  async provision(req, res) {
    const body = provisionMemberSchema.parse(req.body);
    res.json(
      await authService.provisionMember(
        req.user.organisation_id,
        req.user,
        body,
      ),
    );
  },

  // POST /api/admin/team/password — reset an existing member's password.
  async setPassword(req, res) {
    const body = setPasswordSchema.parse(req.body);
    res.json(
      await authService.setMemberPassword(
        req.user.organisation_id,
        req.user,
        body.user_id,
        body.password,
      ),
    );
  },

  // POST /api/admin/team/remove — fully remove a member (cannot remove self;
  // cannot remove a higher/equal role).
  async remove(req, res) {
    const body = removeMemberSchema.parse(req.body);
    res.json(
      await authService.removeMember(
        req.user.organisation_id,
        req.user,
        body.user_id,
      ),
    );
  },
};
