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
//
// CRITICAL: never call `serviceClient.auth.signInWithPassword()` on this
// instance. A successful sign-in stores the USER's session on the client, and
// every subsequent `serviceClient.from(...)` then sends the user's JWT as the
// Authorization header instead of the service_role key — silently dropping the
// RLS bypass. Use `authClient` for password sign-in instead. (Token *verification*
// via `serviceClient.auth.getUser(token)` is safe: passing the token explicitly
// does not persist a session.)
export const serviceClient = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

// Auth-only client (anon key) for password sign-in. Kept separate from
// serviceClient so a sign-in never contaminates the service-role client's
// Authorization header. Only used for `auth.signInWithPassword`; never for data.
export const authClient = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
