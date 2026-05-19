// ============================================================================
// Auth service — signup (org + owner + seed plans, rollback on failure),
// invite (Supabase invite + users row). /me is read straight off req.user
// in the controller so it stays here only for signup/invite logic.
// ============================================================================
import * as auth_repository_1 from "../repositories/auth.repository.js";
import * as errors_1 from "../middleware/errors.js";
export const authService = {
    async signup(body) {
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
        if (error || !data?.session)
            throw new errors_1.AppError('Invalid email or password', 401);
        return {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
        };
    },
    async invite(orgId, body) {
        // Invite via Supabase
        const { data, error } = await auth_repository_1.authRepository.inviteUserByEmail(body.email);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        // Create user record
        await auth_repository_1.authRepository.createUser({
            id: data.user.id,
            organisation_id: orgId,
            email: body.email,
            full_name: body.full_name,
            role: body.role,
        });
        return { success: true };
    },
};
