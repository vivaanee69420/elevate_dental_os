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
    // Public.users row by auth id (GLOBAL — id is the primary key; used by the
    // login gate which has no org context yet).
    getUserById(id) {
        return supabase_1.serviceClient
            .from('users')
            .select('id, organisation_id, role, status')
            .eq('id', id)
            .maybeSingle();
    },
    // Org-scoped fetch for member admin actions.
    getUserInOrg(orgId, id) {
        return supabase_1.serviceClient
            .from('users')
            .select('id, email, organisation_id, role, status')
            .eq('organisation_id', orgId)
            .eq('id', id)
            .maybeSingle();
    },
    // Members of an org for the Team admin UI.
    listOrgMembers(orgId) {
        return supabase_1.serviceClient
            .from('users')
            .select('id, email, full_name, role, status, last_active_at')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: true });
    },
    setUserStatus(id, status) {
        return supabase_1.serviceClient.from('users').update({ status }).eq('id', id);
    },
    setUserRole(orgId, id, role) {
        return supabase_1.serviceClient
            .from('users')
            .update({ role })
            .eq('organisation_id', orgId)
            .eq('id', id);
    },
    // Delete the public.users row (org-scoped).
    deleteUser(orgId, id) {
        return supabase_1.serviceClient
            .from('users')
            .delete()
            .eq('organisation_id', orgId)
            .eq('id', id);
    },
    // Delete the Supabase Auth identity — without this a removed member can
    // still authenticate and the email stays locked (the orphan bug).
    deleteAuthUser(id) {
        return supabase_1.serviceClient.auth.admin.deleteUser(id);
    },
    // Find an existing auth identity by email (orphan detection on signup).
    // Supabase has no get-by-email admin call; scan the user list.
    async findAuthUserByEmail(email) {
        const target = email.toLowerCase();
        let page = 1;
        // Bounded scan — practices are small; cap pages defensively.
        while (page <= 20) {
            const { data, error } = await supabase_1.serviceClient.auth.admin.listUsers({
                page,
                perPage: 200,
            });
            if (error) return { data: null, error };
            const found = (data?.users || []).find(
                (u) => (u.email || '').toLowerCase() === target,
            );
            if (found) return { data: found, error: null };
            if (!data?.users || data.users.length < 200) break;
            page += 1;
        }
        return { data: null, error: null };
    },
};
