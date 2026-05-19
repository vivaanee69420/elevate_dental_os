// ============================================================================
// Auth repository — all Supabase auth + users/organisations data access.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
export const authRepository = {
    createAuthUser(email, password) {
        return supabase_1.serviceClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });
    },
    createOrganisation(name, slug) {
        return supabase_1.serviceClient
            .from('organisations')
            .insert({ name, slug })
            .select()
            .single();
    },
    createUser(row) {
        return supabase_1.serviceClient.from('users').insert(row);
    },
    deleteOrganisation(id) {
        return supabase_1.serviceClient.from('organisations').delete().eq('id', id);
    },
    seedMembershipPlans(rows) {
        return supabase_1.serviceClient.from('membership_plans').insert(rows);
    },
    inviteUserByEmail(email) {
        return supabase_1.serviceClient.auth.admin.inviteUserByEmail(email);
    },
    // Password sign-in — returns a Supabase session (access/refresh tokens).
    signInWithPassword(email, password) {
        return supabase_1.serviceClient.auth.signInWithPassword({ email, password });
    },
    // Seed the dynamic-RBAC default matrix for a new organisation.
    seedRolePermissions(orgId) {
        return supabase_1.serviceClient.rpc('seed_role_permissions', { p_org: orgId });
    },
};
