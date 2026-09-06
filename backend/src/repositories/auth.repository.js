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
    // Cross-org by design: emails are globally unique (Supabase auth), and the
    // membership model needs to know whether this person already has a login
    // anywhere before creating a second one. Returns identity only — never
    // another org's data.
    async findUserByEmail(email) {
        const { data } = await supabase_1.serviceClient
            .from('users')
            .select('id, email')
            .ilike('email', String(email).trim())
            .maybeSingle();
        return data ?? null;
    },
    createUser(row) {
        return supabase_1.serviceClient.from('users').insert(row);
    },
    deleteOrganisation(id) {
        return supabase_1.serviceClient.from('organisations').delete().eq('id', id);
    },
    // Single org row by id — used by /auth/me to surface the name in the topbar.
    getOrganisation(id) {
        return supabase_1.serviceClient
            .from('organisations')
            .select('id, name')
            .eq('id', id)
            .single();
    },
    seedMembershipPlans(rows) {
        return supabase_1.serviceClient.from('membership_plans').insert(rows);
    },
    inviteUserByEmail(email) {
        return supabase_1.serviceClient.auth.admin.inviteUserByEmail(email);
    },
    // Password sign-in — returns a Supabase session (access/refresh tokens).
    // Uses authClient, NOT serviceClient: a successful sign-in persists the
    // user's session on the client and would otherwise hijack every later
    // serviceClient query's Authorization header (dropping the RLS bypass and
    // breaking the provisioning lookup). See lib/supabase.js.
    signInWithPassword(email, password) {
        return supabase_1.authClient.auth.signInWithPassword({ email, password });
    },
    // Admin sets/overwrites a user's password (provision-with-password reset).
    updateUserPassword(id, password) {
        return supabase_1.serviceClient.auth.admin.updateUserById(id, { password });
    },
    // Best-effort revoke of all of `id`'s sessions after an admin password
    // reset. GoTrue/supabase-js exposes no guaranteed per-user admin signout
    // (admin.signOut needs the *user's* JWT, which the server does not hold).
    // We hit the GoTrue admin REST logout route directly with the service
    // role key; a non-2xx (older GoTrue lacking the route) is logged by the
    // caller and treated as non-fatal — the access-token TTL still bounds the
    // residual window. Strongest control the platform allows.
    async revokeUserSessions(id) {
        const url = `${process.env.SUPABASE_URL}/auth/v1/admin/users/${id}/logout`;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ scope: 'global' }),
        });
        return { ok: res.ok, status: res.status };
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
    // Members of SEVERAL orgs (the agency-wide team list). Paged: PostgREST
    // truncates at 1000 rows without saying so, and an agency with many
    // sub-accounts passes that quietly. Stop on an EMPTY page — a short page
    // is not the end.
    async listMembersForOrgs(orgIds) {
        if (!orgIds?.length) return [];
        const PAGE = 500;
        const out = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('users')
                .select('id, organisation_id, email, full_name, phone, role, status, is_agency_admin, last_active_at')
                .in('organisation_id', orgIds)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            out.push(...data);
        }
        return out;
    },
    // One member, but only if they sit in an org this caller administers.
    // maybeSingle so "not in scope" is null rather than a thrown PGRST116.
    async getUserInOrgs(orgIds, userId) {
        if (!orgIds?.length) return null;
        const { data, error } = await supabase_1.serviceClient
            .from('users')
            .select('id, organisation_id, email, full_name, phone, role, status, is_agency_admin, last_active_at, permissions')
            .in('organisation_id', orgIds)
            .eq('id', userId)
            .maybeSingle();
        if (error) throw error;
        return data ?? null;
    },
    // Org-scoped profile/role/permissions write. The org filter is the tenant
    // boundary on this table — never update by id alone.
    async updateMember(orgId, userId, patch) {
        const { error } = await supabase_1.serviceClient
            .from('users')
            .update(patch)
            .eq('organisation_id', orgId)
            .eq('id', userId);
        if (error) throw error;
    },
    setUserStatus(id, status) {
        return supabase_1.serviceClient.from('users').update({ status }).eq('id', id);
    },
    // NOTE: currently unreachable — no route/controller/service calls this.
    // The hole is latent only. If ever wired to an endpoint, the caller MUST
    // gate it with authService.canManageTarget(caller.role, target.role)
    // (same escalation class as removeMember / setMemberPassword), else a
    // non-owner with users.manage could re-role themselves to owner.
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
