"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRepository = void 0;
// ============================================================================
// Auth repository — all Supabase auth + users/organisations data access.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.authRepository = {
    createAuthUser(email, password) {
        return supabase_1.serviceClient.auth.admin.createUser({
            email,
            password,
            email_confirm: false,
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
};
