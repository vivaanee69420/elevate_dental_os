// ============================================================================
// Team administration — the people surface behind Settings → Team.
//
// The scope rule lives here and nowhere else:
//   plain owner            -> their OWN org
//   agency admin at home   -> the agency org AND its children
//   agency admin SWITCHED  -> only the child they are switched into
//
// The switched case matters: authenticate() changes req.user.organisation_id
// by TWO independent paths — the agency-switch cookie (stamps
// req.agencyContext) and the x-active-org membership header (stamps
// req.activeOrgSwitched, no other signal) — and while acting through either
// one the admin is standing in that account, not at home. Handing them the
// whole agency's people in that state would contradict the account they are
// standing in, so BOTH signals gate agency-wide scope, not just one.
//
// No organisation id is ever taken from a request body.
// ============================================================================
import { agencyRepository } from '../repositories/agency.repository.js';
import { authRepository } from '../repositories/auth.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';
import { AppError } from '../middleware/errors.js';
import { permissionsService } from './permissions.service.js';
import { authService, canManageTarget, assertGrantCeiling } from './auth.service.js';
import { isValidPermission } from '../lib/permissions.js';

/** The orgs this request administers. See the header for the rule. */
export async function adminScope(req) {
  const orgId = req.user.organisation_id;
  const agencyWide =
    req.user.is_agency_admin === true &&
    !!req.agencyOrgId &&
    !req.agencyContext &&
    !req.activeOrgSwitched;
  if (!agencyWide) return { orgIds: [orgId], agencyWide: false, agencyOrgId: null };
  const children = await agencyRepository.childOrgs(req.agencyOrgId);
  return {
    orgIds: [req.agencyOrgId, ...children.map((c) => c.id)],
    agencyWide: true,
    agencyOrgId: req.agencyOrgId,
  };
}

/**
 * Apply a tri-state permission patch to a user's stored overrides.
 * `null` DELETES the key — the row goes back to inheriting its role — which
 * is what the editor's reset control sends. `false` is an explicit deny and
 * is kept.
 */
export function mergeOverrides(current, patch) {
  const out = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete out[key];
    else out[key] = !!value;
  }
  return out;
}

/**
 * The pure half of applyAccounts: is this list of org ids one this caller may
 * assign, and does it keep the member's home account? Separated so create()
 * can reject a bad list BEFORE it commits a login — validating after the
 * write is what leaves an accountless user behind. Every requested id is
 * checked against the orgs THIS caller administers — the ids arrive in the
 * request body, so they are input, never authority. Returns the deduped id
 * list (the id list is client-supplied and a duplicate must not produce two
 * rows for the same account in the upsert batch that follows).
 */
function assertAccountIds(scope, homeOrgId, requestedIds) {
  const allowed = new Set(scope.orgIds);
  for (const id of requestedIds) {
    if (!allowed.has(id)) {
      throw new AppError('Not a sub-account of your organisation', 404);
    }
  }

  const ids = [...new Set(requestedIds)];

  if (!ids.includes(homeOrgId)) {
    throw new AppError(
      'A member\'s home account cannot be removed — it is where they sign in',
      400,
    );
  }
  return ids;
}

/**
 * Reconcile which accounts one person reaches.
 *
 * The same role and permission map goes to every row: one screen states the
 * whole truth about a person, and until this existed nothing wrote
 * user_organisations.permissions at all, so a person in five accounts kept
 * their overrides in one and silently fell back to role defaults in the rest.
 *
 * Memberships of orgs OUTSIDE the scope are left completely alone — this
 * caller cannot see them, so it must not delete them either.
 *
 * Batched, not transactional: one addMany() upsert and one removeMany()
 * delete, rather than a statement per account. That takes a multi-account
 * assignment from N failure points down to two — full atomicity would need
 * a transaction or an RPC, i.e. a migration, which this plan does not carry.
 * The residual is accepted because both batches are keyed the same way the
 * single-row add()/remove() always were — (user_id, organisation_id) — so a
 * save that fails partway through converges to the same end state on retry
 * from ANY partial state. A failed save is retryable, not corrupting.
 */
async function applyAccounts(scope, target, userId, requestedIds, role, permissions) {
  const ids = assertAccountIds(scope, target.organisation_id, requestedIds);

  const current = await membershipRepository.listForUser(userId);

  await membershipRepository.addMany(
    ids.map((id) => ({ user_id: userId, organisation_id: id, role, permissions })),
  );
  const allowed = new Set(scope.orgIds);
  const toRemove = current
    .filter((m) => allowed.has(m.organisation_id) && !ids.includes(m.organisation_id))
    .map((m) => m.organisation_id);
  await membershipRepository.removeMany(userId, toRemove);

  return ids;
}

export const teamService = {
  async list(scope) {
    const members = await authRepository.listMembersForOrgs(scope.orgIds);
    if (!scope.agencyWide) return { members, agency_wide: false };

    // Which accounts each person reaches. Filtered to the administered orgs:
    // a membership of some unrelated org is none of this caller's business,
    // and naming it here would leak that org's existence.
    const byUser = await membershipRepository.listForUsers(
      members.map((m) => m.id),
      scope.orgIds,
    );
    const names = await agencyRepository.orgNames(scope.orgIds);
    return {
      agency_wide: true,
      members: members.map((m) => {
        // The member's home org comes from the users row itself, not from
        // user_organisations: that table is additive, and provisionMember /
        // invite never write a row to it, so a user onboarded since the
        // backfill has none. Building accounts from memberships alone would
        // report "no accounts" for someone who plainly has one.
        const accounts = [{
          id: m.organisation_id,
          name: names.get(m.organisation_id) ?? null,
          role: m.role,
        }];
        for (const r of byUser.get(m.id) ?? []) {
          if (r.organisation_id !== m.organisation_id) {
            accounts.push({
              id: r.organisation_id,
              name: names.get(r.organisation_id) ?? null,
              role: r.role,
            });
          }
        }
        return { ...m, accounts };
      }),
    };
  },

  // One member, for the editor: profile, role, memberships, effective
  // permissions, and which of those are explicit overrides.
  async get(scope, userId) {
    const row = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!row) throw new AppError('Member not found', 404);
    const { permissions: overrides, ...member } = row;

    const memberships = await membershipRepository.listForUser(userId);
    // Same reasoning as list(): user_organisations is additive, so the home
    // org (from the users row) is seeded first and in-scope memberships are
    // unioned in, skipping the home org's own id so it is never duplicated.
    const inScope = memberships.filter(
      (m) => scope.orgIds.includes(m.organisation_id) && m.organisation_id !== member.organisation_id,
    );

    // listForUser only names orgs that HAVE a membership row, so the home
    // org's name needs its own lookup — one extra read.
    const homeNames = await agencyRepository.orgNames([member.organisation_id]);
    const accounts = [
      { id: member.organisation_id, name: homeNames.get(member.organisation_id) ?? null, role: member.role },
      ...inScope.map((m) => ({ id: m.organisation_id, name: m.name, role: m.role })),
    ];

    // Effective = catalogue <- role_permissions <- this user's overrides,
    // resolved exactly the way a request resolves it, so the editor shows
    // what the person actually gets rather than an approximation of it.
    const effective = await permissionsService.getEffectiveForUser(
      member.organisation_id,
      member.role,
      overrides || {},
    );

    // The role defaults the editor previews an UNPINNED row against, resolved
    // for the TARGET's organisation — role_permissions is per-organisation,
    // so an agency admin editing a sub-account user must see that account's
    // defaults, not their own org's. Reading them from the caller's matrix
    // (GET /api/admin/permissions) previewed the agency's answer while the
    // save wrote the child's: correct result, wrong picture.
    const { roles: roleDefaults } = await permissionsService.getMatrix(
      member.organisation_id,
    );

    return {
      member,
      overrides: overrides || {},
      effective,
      role_defaults: roleDefaults,
      accounts,
    };
  },

  // PUT /api/admin/team/:id — profile, role, permission overrides, and (for
  // an agency admin) account assignment, in one save. A non-agency caller
  // sending organisation_ids is rejected outright rather than silently
  // ignored, so the endpoint is never briefly permissive.
  async save(scope, caller, userId, body) {
    const target = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!target) throw new AppError('Member not found', 404);

    // Two hierarchy checks, not one: you must be able to manage the person as
    // they are now, AND you must not be able to hand them a role above your
    // own. Checking only the first lets a practice manager promote a
    // receptionist to owner and then be outranked by them.
    if (!canManageTarget(caller.role, target.role)) {
      throw new AppError('You cannot manage a member of that role', 403);
    }
    if (body.role && !canManageTarget(caller.role, body.role)) {
      throw new AppError('You cannot assign a role above your own', 403);
    }

    // You cannot change your own role. canManageTarget('owner', …) is
    // unconditionally true, so without this an owner could demote themselves
    // and lose access on the very next request — a self-lockout if they are
    // the only owner. Same reasoning as the self guards on setMemberPassword
    // and removeMember. Profile fields are still yours to edit.
    if (caller.id === userId && body.role !== undefined && body.role !== target.role) {
      throw new AppError('You cannot change your own role', 400);
    }

    for (const key of Object.keys(body.permissions || {})) {
      if (!isValidPermission(key)) throw new AppError(`Unknown permission: ${key}`, 400);
    }
    assertGrantCeiling(caller, body.permissions);

    if (body.organisation_ids !== undefined && !scope.agencyWide) {
      throw new AppError('Only an agency admin can assign accounts', 403);
    }

    const overrides = mergeOverrides(target.permissions, body.permissions);
    const nextRole = body.role ?? target.role;

    // Validate and reconcile the accounts FIRST: a rejected org id must leave
    // the profile untouched, not half-saved.
    let accounts;
    if (body.organisation_ids !== undefined) {
      accounts = await applyAccounts(
        scope, target, userId, body.organisation_ids, nextRole, overrides,
      );
    }

    // Only rewrite the stored overrides when the patch actually touches
    // them — a name-only edit must not audit a false "permissions changed"
    // line (rule 9). The response still reports the merged overrides either
    // way, so its shape never depends on what was in the patch.
    const patch = {};
    if (body.permissions !== undefined) patch.permissions = overrides;
    if (body.full_name !== undefined) patch.full_name = body.full_name;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.role !== undefined) patch.role = body.role;

    // Written against the target's OWN org, not the caller's — an agency
    // admin edits people who sit in a sub-account.
    await authRepository.updateMember(target.organisation_id, userId, patch);

    // organisation_id is the org this write LANDED in, which is not the
    // caller's when an agency admin edits a sub-account user. The controller
    // stamps it onto the request so the audit row is filed against the
    // account whose data changed (rule 9) rather than the agency's.
    return {
      success: true,
      permissions: overrides,
      accounts,
      organisation_id: target.organisation_id,
    };
  },

  // POST /api/admin/team — create the login and assign its accounts in one
  // call. Doing this as two client calls (create, then assign) would leave
  // a user created with no accounts when the second call fails.
  async create(scope, caller, body) {
    // Where the login lives. An agency admin may put it in a sub-account; a
    // plain owner may only ever name their own org, and naming any other is
    // refused rather than quietly redirected home.
    const homeOrg = body.home_organisation_id ?? scope.orgIds[0];
    if (!scope.orgIds.includes(homeOrg)) {
      throw new AppError('Not a sub-account of your organisation', 404);
    }
    if (body.organisation_ids !== undefined && !scope.agencyWide) {
      throw new AppError('Only an agency admin can assign accounts', 403);
    }

    // R10: the home membership is ALWAYS recorded, not only when the caller
    // named extra accounts — provisionMember/invite never write a
    // user_organisations row at all, which is the exact gap list()/get() are
    // seen working around by seeding `accounts` from the users row. A user
    // created through this screen should be consistent with that table from
    // the start, so an absent organisation_ids defaults to just the home org
    // and is routed through the SAME applyAccounts path rather than a second
    // write idiom. That default is safe here — for a brand-new user there
    // are no existing memberships for applyAccounts to prune — but it must
    // stay local to create(): save() keeps treating an absent
    // organisation_ids as "do not touch the accounts", since defaulting
    // there would silently strip a person's other accounts on a
    // profile-only edit.
    const accountIds = body.organisation_ids ?? [homeOrg];

    // Validate the account list BEFORE creating the login, not after.
    // applyAccounts runs this same check, but by then provisionMember/invite
    // will already have committed an auth.users + public.users row — a
    // stale/mistyped id in scope, or a home org left out of the list, would
    // 404/400 back to the caller while a live login with zero membership
    // rows sits behind it. The caller has every reason to believe nothing
    // happened; that is exactly the half-created state this endpoint exists
    // to prevent. Same discipline save() already applies ("Validate...
    // FIRST"), just moved ahead of the bigger write this endpoint makes.
    assertAccountIds(scope, homeOrg, accountIds);

    const permissions = body.permissions || {};
    const input = {
      email: body.email,
      full_name: body.full_name,
      role: body.role,
      permissions,
    };
    // provisionMember/invite already enforce the role hierarchy and the
    // grant ceiling against `caller`, so they are not re-checked here.
    const created = body.password
      ? await authService.provisionMember(homeOrg, caller, { ...input, password: body.password })
      : await authService.invite(homeOrg, caller, input);

    const accounts = await applyAccounts(
      scope,
      { organisation_id: homeOrg },
      created.user_id,
      accountIds,
      body.role,
      permissions,
    );

    // Phone is written LAST, after the membership rows, not before. The
    // login is committed the moment provisionMember/invite returns — nothing
    // short of a transaction changes that — so this ordering does not make
    // the sequence atomic. What it does control is what a failure AFTER the
    // login leaves behind: a phone-write failure here leaves a user who is
    // correctly created and correctly assigned to their accounts, missing
    // only a phone number — a trivial re-edit — rather than reopening the
    // accountless-orphan gap this fix exists to close.
    if (body.phone) {
      await authRepository.updateMember(homeOrg, created.user_id, { phone: body.phone });
    }

    return { ...created, accounts, organisation_id: homeOrg };
  },

  // POST /api/admin/team/remove — delete a member of ANY administered org.
  //
  // The scope lookup is the whole point: the controller used to hand
  // authService the CALLER's org, and authService resolves its target with
  // getUserInOrg(orgId, id), so every sub-account row on the agency-wide list
  // rendered a Remove button that could only ever answer "Member not found in
  // this organisation". Resolve the target against the administered orgs
  // first, then hand authService the org the target actually sits in.
  //
  // The self-check and the role hierarchy are NOT re-implemented here —
  // authService.removeMember still owns them, and it still runs its own
  // org-scoped lookup with the org this passes it.
  async remove(scope, caller, userId) {
    const target = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!target) throw new AppError('Member not found', 404);
    const result = await authService.removeMember(
      target.organisation_id,
      caller,
      userId,
    );
    return { ...result, organisation_id: target.organisation_id };
  },

  // POST /api/admin/team/password — same fix, same reasoning, for the admin
  // password reset. authService.setMemberPassword keeps its self-check and
  // its role hierarchy check.
  async setPassword(scope, caller, userId, password) {
    const target = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!target) throw new AppError('Member not found', 404);
    const result = await authService.setMemberPassword(
      target.organisation_id,
      caller,
      userId,
      password,
    );
    return { ...result, organisation_id: target.organisation_id };
  },
};
