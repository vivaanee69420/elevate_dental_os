// ============================================================================
// Auth service — signup (org + owner + seed plans, rollback on failure),
// invite (Supabase invite + users row). /me is read straight off req.user
// in the controller so it stays here only for signup/invite logic.
// ============================================================================
import * as auth_repository_1 from "../repositories/auth.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const authService = {
    async signup(body) {
        // Orphan reclaim: a prior org/user deletion cascades public.users but
        // NOT auth.users. If an auth identity for this email exists with no
        // public.users row, it is a dead orphan blocking re-signup — delete it
        // so the email is reusable. (If it DOES have a public.users row the
        // account is live; reject rather than clobber it.)
        const { data: existingAuth } = await auth_repository_1.authRepository.findAuthUserByEmail(body.email);
        if (existingAuth) {
            const { data: existingRow } = await auth_repository_1.authRepository.getUserById(existingAuth.id);
            if (existingRow) {
                throw new errors_1.AppError('An account with this email already exists', 409);
            }
            await auth_repository_1.authRepository.deleteAuthUser(existingAuth.id);
        }
        // Create auth user
        const { data: authData, error: authError } = await auth_repository_1.authRepository.createAuthUser(body.email, body.password);
        if (authError)
            throw new errors_1.AppError(authError.message, 400);
        // Create organisation
        const slug = body.organisation_name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
        const { data: org, error: orgError } = await auth_repository_1.authRepository.createOrganisation(body.organisation_name, slug);
        if (orgError)
            throw new errors_1.AppError(orgError.message, 400);
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
        const { data, error } = await auth_repository_1.authRepository.signInWithPassword(body.email, body.password);
        if (error || !data?.session || !data?.user)
            throw new errors_1.AppError('Invalid email or password', 401);
        // Provisioning gate: a valid Supabase auth identity is NOT enough.
        // There must be a public.users row (admin-provisioned) for this id.
        // No row = deleted/orphaned identity -> deny (no usable session).
        const { data: row } = await auth_repository_1.authRepository.getUserById(data.user.id);
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
    // Admin adds a team member: Supabase invite email + an 'invited' users
    // row carrying the chosen role. Per-member permission overrides (if any)
    // are applied separately via the permissions service. The member cannot
    // log in until they accept the invite (set a password) -> 'active'.
    async invite(orgId, body) {
        // Reclaim a dead orphan auth identity for this email if present.
        const { data: existingAuth } = await auth_repository_1.authRepository.findAuthUserByEmail(body.email);
        if (existingAuth) {
            const { data: existingRow } = await auth_repository_1.authRepository.getUserById(existingAuth.id);
            if (existingRow) {
                throw new errors_1.AppError('This email is already a member', 409);
            }
            await auth_repository_1.authRepository.deleteAuthUser(existingAuth.id);
        }
        const { data, error } = await auth_repository_1.authRepository.inviteUserByEmail(body.email);
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
            // Roll back the auth identity so the email is not left orphaned.
            await auth_repository_1.authRepository.deleteAuthUser(data.user.id);
            throw new errors_1.AppError(userError.message, 400);
        }
        return { success: true, user_id: data.user.id, status: 'invited' };
    },
    // List org members for the Team admin UI.
    async listMembers(orgId) {
        const { data, error } = await auth_repository_1.authRepository.listOrgMembers(orgId);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return { members: data || [] };
    },
    // Fully remove a member: delete the public.users row AND the Supabase
    // auth identity (without the latter they could still authenticate and the
    // email stays locked — the orphan bug). Owner-gated; cannot remove self.
    async removeMember(orgId, requesterId, targetId) {
        if (requesterId === targetId)
            throw new errors_1.AppError('You cannot remove yourself', 400);
        const { data: target } = await auth_repository_1.authRepository.getUserInOrg(orgId, targetId);
        if (!target)
            throw new errors_1.AppError('Member not found in this organisation', 404);
        const { error: delErr } = await auth_repository_1.authRepository.deleteUser(orgId, targetId);
        if (delErr)
            throw new errors_1.AppError(delErr.message, 400);
        await auth_repository_1.authRepository.deleteAuthUser(targetId);
        return { success: true };
    },
};
