// ============================================================================
// Supabase client helpers
// ============================================================================
// Two clients:
// - serviceClient: bypasses RLS, used by background workers/webhooks only
// - tenantClient(orgId, role): for per-request user-scoped queries
// ============================================================================
import * as supabase_js_1 from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing required Supabase env vars');
}

// Service client — full access, bypasses RLS
// USE ONLY IN: webhooks, background jobs, system tasks
export const serviceClient = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

// User-scoped client — respects RLS using JWT claims
export function tenantClient(accessToken) {
    return (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

// Helper to verify a JWT and extract claims
export async function verifyToken(token) {
    const { data, error } = await serviceClient.auth.getUser(token);
    if (error || !data.user)
        throw new Error('Invalid token');
    return data.user;
}
