// ============================================================================
// Auth service — signup, login, and admin team provisioning.
//
//  signup            org + owner + seed plans/perms (rollback on failure)
//  login             provisioning gate; first invited login -> active
//  invite            Supabase invite email + 'invited' row (email fallback)
//  provisionMember   admin sets the password directly -> 'active' at once
//  setMemberPassword admin resets an existing member's password + revoke
//  removeMember      delete public.users + auth identity
//
// Authorization helpers (shared, pure):
//
//   canManageTarget(callerRole, targetRole)
//     ┌ owner ──────────────► may target anyone
//     └ non-owner ─► may target ONLY a strictly lower rank
//                    (so nobody can touch an owner, or an equal rank).
//     Self-targeting is rejected by the callers (id compare), not here.
//
//   assertGrantCeiling(caller, permissions)
//     A caller may only hand out permission keys it itself effectively
//     holds (owner is exempt). Without this the role guard is bypassable:
//     a practice_manager could provision a reception member carrying
//     finance.view/system.manage — a junior account outranking its
//     creator (users.permissions wins at highest precedence in
//     lib/permissions.js resolveEffectivePermissions).
// ============================================================================
import * as auth_repository_1 from "../repositories/auth.repository.js";
import * as errors_1 from "../middleware/errors.js";

// owner > practice_manager > reception
const ROLE_RANK = { owner: 3, practice_manager: 2, reception: 1 };

/** True if a caller with `callerRole` may act on a member with `targetRole`. */
export function canManageTarget(callerRole, targetRole) {
    if (callerRole === 'owner') return true;
    const c = ROLE_RANK[callerRole];
    const t = ROLE_RANK[targetRole];
    return !!c && !!t && c > t;
}

/**
 * Throw 403 unless `caller` effectively holds every permission it is trying
 * to grant. Keys set false (narrowing) are always allowed. Owner is exempt.
 * @param {{role:string, permissions?:Object}} caller  req.user
 * @param {Object|undefined} permissions  requested users.permissions overrides
 */
export function assertGrantCeiling(caller, permissions) {
    if (!permissions || caller.role === 'owner') return;
    const held = caller.permissions || {};
    for (const [key, want] of Object.entries(permissions)) {
        if (want === true && held[key] !== true) {
            throw new errors_1.AppError(
                `You cannot grant a permission you do not hold: ${key}`,
                403,
            );
        }
    }
}

/**
 * Orphan reclaim (shared by signup/invite/provisionMember). A prior org/user
 * deletion cascades public.users but NOT auth.users; a leftover auth identity
 * with no public.users row is a dead orphan that blocks reuse of the email —
 * delete it. If it DOES have a public.users row the account is live: reject.
 */
async function reclaimOrphanAuthIdentity(email, liveMessage) {
    const { data: existingAuth } =
        await auth_repository_1.authRepository.findAuthUserByEmail(email);
    if (!existingAuth) return;
    const { data: existingRow } =
        await auth_repository_1.authRepository.getUserById(existingAuth.id);
    if (existingRow) {
        throw new errors_1.AppError(liveMessage, 409);
    }
    await auth_repository_1.authRepository.deleteAuthUser(existingAuth.id);
}

/**
 * Roll back a just-created auth identity after the public.users insert
 * failed. If the compensating delete ITSELF fails we have manufactured the
 * exact orphan reclaim exists to clean up — log it loudly so it is visible
 * (reclaim will absorb it on the next signup/invite for this email).
 */
async function rollbackAuthIdentity(authId, email) {
    try {
        const { error } =
            (await auth_repository_1.authRepository.deleteAuthUser(authId)) || {};
        if (error) throw error;
    } catch (delErr) {
        // eslint-disable-next-line no-console
        console.error(
            JSON.stringify({
                event: 'ORPHAN_AUTH_USER',
                reason: 'compensating deleteAuthUser failed',
                auth_id: authId,
                email,
                error: delErr?.message || String(delErr),
            }),
        );
    }
}

export const authService = {
    // Org name for /auth/me (topbar). Null if the row is missing — the
    // controller must not 500 just because the header label can't resolve.
    async organisationName(orgId) {
        const { data } = await auth_repository_1.authRepository.getOrganisation(orgId);
        return data?.name ?? null;
    },

    async signup(body) {
        await reclaimOrphanAuthIdentity(
            body.email,
            'An account with this email already exists',
        );
        // Create auth user
        const { data: authData, error: authError } =
            await auth_repository_1.authRepository.createAuthUser(body.email, body.password);
        if (authError)
            throw new errors_1.AppError(authError.message, 400);
        // Create organisation
        const slug = body.organisation_name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
        const { data: org, error: orgError } =
            await auth_repository_1.authRepository.createOrganisation(body.organisation_name, slug);
        if (orgError) {
            await rollbackAuthIdentity(authData.user.id, body.email);
            throw new errors_1.AppError(orgError.message, 400);
        }
        // Create user record (as owner)
        const { error: userError } = await auth_repository_1.authRepository.createUser({
            id: authData.user.id,
            organisation_id: org.id,
            email: body.email,
            full_name: body.full_name,
            role: 'owner',
            status: 'active', // signup owner is immediately active
        });
        if (userError) {
            await auth_repository_1.authRepository.deleteOrganisation(org.id);
            await rollbackAuthIdentity(authData.user.id, body.email);
            throw new errors_1.AppError(userError.message, 400);
        }
        // Seed default membership plans
        await auth_repository_1.authRepository.seedMembershipPlans([
            { organisation_id: org.id, name: 'Smile Club Essential', monthly_price_pence: 1495,
                benefits: ['2 hygiene visits/year', 'Annual exam', '10% off treatments'] },
            { organisation_id: org.id, name: 'Smile Club Plus', monthly_price_pence: 2495,
                benefits: ['4 hygiene visits/year', 'Annual exam', '15% off treatments', 'Emergency cover'] },
        ]);
        // Seed the dynamic-RBAC default permission matrix for this org.
        await auth_repository_1.authRepository.seedRolePermissions(org.id);
        return { success: true, organisation_id: org.id };
    },

    async login(body) {
        const { data, error } =
            await auth_repository_1.authRepository.signInWithPassword(body.email, body.password);
        if (error || !data?.session || !data?.user)
            throw new errors_1.AppError('Invalid email or password', 401);
        // Provisioning gate: a valid Supabase auth identity is NOT enough.
        // There must be a public.users row (admin-provisioned) for this id.
        const { data: row } =
            await auth_repository_1.authRepository.getUserById(data.user.id);
        if (!row) {
            throw new errors_1.AppError('Account not provisioned. Contact your administrator.', 403);
        }
        // First successful password login after an invite flips the member
        // from 'invited' to 'active' (they have now set their password).
        if (row.status === 'invited') {
            await auth_repository_1.authRepository.setUserStatus(data.user.id, 'active');
        }
        return {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
        };
    },

    // Admin adds a team member via Supabase invite email (email fallback,
    // for when SMTP/WhatsApp is configured). Row starts 'invited'; the member
    // cannot log in until they accept and set a password -> 'active'.
    async invite(orgId, caller, body) {
        if (!canManageTarget(caller.role, body.role))
            throw new errors_1.AppError('You cannot manage a member of that role', 403);
        assertGrantCeiling(caller, body.permissions);
        await reclaimOrphanAuthIdentity(body.email, 'This email is already a member');
        const { data, error } =
            await auth_repository_1.authRepository.inviteUserByEmail(body.email);
        if (error || !data?.user)
            throw new errors_1.AppError(error?.message || 'Invite failed', 400);
        const { error: userError } = await auth_repository_1.authRepository.createUser({
            id: data.user.id,
            organisation_id: orgId,
            email: body.email,
            full_name: body.full_name,
            role: body.role,
            permissions: body.permissions || {},
            status: 'invited',
        });
        if (userError) {
            await rollbackAuthIdentity(data.user.id, body.email);
            throw new errors_1.AppError(userError.message, 400);
        }
        return { success: true, user_id: data.user.id, status: 'invited' };
    },

    // Admin provisions a member WITH a password: 'active' immediately, can
    // log in at once (no email round-trip — primary path until delivery is
    // configured).
    async provisionMember(orgId, caller, body) {
        if (!canManageTarget(caller.role, body.role))
            throw new errors_1.AppError('You cannot manage a member of that role', 403);
        assertGrantCeiling(caller, body.permissions);
        await reclaimOrphanAuthIdentity(body.email, 'This email is already a member');
        const { data: authData, error: authError } =
            await auth_repository_1.authRepository.createAuthUser(body.email, body.password);
        if (authError || !authData?.user)
            throw new errors_1.AppError(authError?.message || 'Could not create account', 400);
        const { error: userError } = await auth_repository_1.authRepository.createUser({
            id: authData.user.id,
            organisation_id: orgId,
            email: body.email,
            full_name: body.full_name,
            role: body.role,
            permissions: body.permissions || {},
            status: 'active',
        });
        if (userError) {
            await rollbackAuthIdentity(authData.user.id, body.email);
            throw new errors_1.AppError(userError.message, 400);
        }
        return { success: true, user_id: authData.user.id, status: 'active' };
    },

    // Admin resets an existing member's password. Org-scoped lookup BEFORE
    // the (global) auth update so a request can never touch another tenant.
    // Sessions are revoked best-effort so a compromise-driven reset does not
    // leave the old session alive.
    async setMemberPassword(orgId, caller, targetId, password) {
        if (caller.id === targetId)
            throw new errors_1.AppError('Use account settings to change your own password', 400);
        const { data: target } =
            await auth_repository_1.authRepository.getUserInOrg(orgId, targetId);
        if (!target)
            throw new errors_1.AppError('Member not found in this organisation', 404);
        if (!canManageTarget(caller.role, target.role))
            throw new errors_1.AppError('You cannot manage a member of that role', 403);
        const { error } =
            await auth_repository_1.authRepository.updateUserPassword(targetId, password);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        // Best-effort: revoke existing sessions. Non-fatal — password is
        // already changed; a failed revoke is bounded by access-token TTL.
        try {
            await auth_repository_1.authRepository.revokeUserSessions(targetId);
        } catch {
            // eslint-disable-next-line no-console
            console.error(
                JSON.stringify({ event: 'SESSION_REVOKE_FAILED', user_id: targetId }),
            );
        }
        return { success: true };
    },

    // List org members for the Team admin UI.
    async listMembers(orgId) {
        const { data, error } =
            await auth_repository_1.authRepository.listOrgMembers(orgId);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return { members: data || [] };
    },

    // Fully remove a member: delete the public.users row AND the Supabase
    // auth identity (without the latter they could still authenticate and the
    // email stays locked — the orphan bug). Cannot remove self; cannot remove
    // a member whose role outranks/equals the caller's (closes the
    // pre-existing PM-removes-Owner escalation — same guard as password ops).
    async removeMember(orgId, caller, targetId) {
        if (caller.id === targetId)
            throw new errors_1.AppError('You cannot remove yourself', 400);
        const { data: target } =
            await auth_repository_1.authRepository.getUserInOrg(orgId, targetId);
        if (!target)
            throw new errors_1.AppError('Member not found in this organisation', 404);
        if (!canManageTarget(caller.role, target.role))
            throw new errors_1.AppError('You cannot manage a member of that role', 403);
        const { error: delErr } =
            await auth_repository_1.authRepository.deleteUser(orgId, targetId);
        if (delErr)
            throw new errors_1.AppError(delErr.message, 400);
        await auth_repository_1.authRepository.deleteAuthUser(targetId);
        return { success: true };
    },
};
