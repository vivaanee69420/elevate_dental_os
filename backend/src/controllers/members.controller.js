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
  saveMemberSchema,
  createMemberSchema,
} from "../models/auth.model.js";
import { authService } from "../services/auth.service.js";
import { adminScope, teamService } from "../services/team.service.js";

/**
 * File the audit row against the org the write LANDED in, and mark who
 * reached across to make it.
 *
 * An agency admin acting at HOME edits people who sit in a sub-account, and
 * middleware/audit.js only marks a row when req.agencyContext is set — which
 * happens only while SWITCHED. Left alone, a sub-account owner reading their
 * own audit_log would never see that one of their users was re-roled.
 *
 * A same-org write stamps nothing, so it keeps today's behaviour exactly.
 */
function stampAudit(req, targetOrgId) {
  if (!targetOrgId || targetOrgId === req.user.organisation_id) return;
  req.auditOrgId = targetOrgId;
  req.auditVia = {
    home_organisation_id: req.agencyOrgId ?? req.user.organisation_id,
    actor_user_id: req.user.id,
  };
}

export const membersController = {
  // GET /api/admin/team — the people this caller administers. One org for
  // everyone but an agency admin acting at home.
  async list(req, res) {
    const scope = await adminScope(req);
    res.json(await teamService.list(scope));
  },

  // POST /api/admin/team — create a login and assign its accounts in one
  // call.
  async create(req, res) {
    const body = createMemberSchema.parse(req.body);
    const scope = await adminScope(req);
    const out = await teamService.create(scope, req.user, body);
    stampAudit(req, out.organisation_id);
    res.json(out);
  },

  // GET /api/admin/team/:id — one member, for the editor.
  async getOne(req, res) {
    const scope = await adminScope(req);
    res.json(await teamService.get(scope, req.params.id));
  },

  // PUT /api/admin/team/:id — profile, role, permission overrides and (agency
  // only) the accounts this person reaches, in one save.
  async save(req, res) {
    const body = saveMemberSchema.parse(req.body);
    const scope = await adminScope(req);
    const out = await teamService.save(scope, req.user, req.params.id, body);
    stampAudit(req, out.organisation_id);
    res.json(out);
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
  // Routed through adminScope like its siblings: the target may sit in a
  // sub-account, and passing the CALLER's org made every agency-wide row's
  // reset fail with "Member not found in this organisation".
  async setPassword(req, res) {
    const body = setPasswordSchema.parse(req.body);
    const scope = await adminScope(req);
    const out = await teamService.setPassword(
      scope,
      req.user,
      body.user_id,
      body.password,
    );
    stampAudit(req, out.organisation_id);
    res.json(out);
  },

  // POST /api/admin/team/remove — fully remove a member (cannot remove self;
  // cannot remove a higher/equal role). Same scope fix as setPassword.
  async remove(req, res) {
    const body = removeMemberSchema.parse(req.body);
    const scope = await adminScope(req);
    const out = await teamService.remove(scope, req.user, body.user_id);
    stampAudit(req, out.organisation_id);
    res.json(out);
  },
};
