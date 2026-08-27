// ============================================================================
// Supabase client helpers
// ============================================================================
// Two clients:
// - serviceClient: bypasses RLS, used by background workers/webhooks only
// - tenantClient(orgId, role): for per-request user-scoped queries
// ============================================================================
import * as supabase_js_1 from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// HS256 symmetric secret (Supabase → Settings → API → JWT Secret). Optional:
// when set, JWTs are verified locally (no network round trip); when absent,
// verifyToken falls back to the remote getUser call — behaviour unchanged.
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
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

// Auth-only client for password sign-in. Kept separate from serviceClient so
// a sign-in never contaminates the service-role client's Authorization header.
// Only used for `auth.signInWithPassword`; never for data.
//
// Built with the SERVICE key, not the anon key: this is a server-to-server
// call (the browser never talks to GoTrue directly), and Supabase's captcha
// protection (Authentication → Attack Protection) rejects anon-key password
// sign-ins that carry no captcha token — which surfaced as every login
// failing with 401 "Invalid email or password". The service key is exempt
// from that check; abuse protection for this route is the 5/min/IP limiter
// in app.js.
export const authClient = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

// User-scoped client — respects RLS using JWT claims
export function tenantClient(accessToken) {
    return (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

// Helper to verify a JWT and extract claims.
//
// Fast path: when SUPABASE_JWT_SECRET is configured, verify the HS256
// signature LOCALLY — no network round trip per request. The returned shape is
// compatible with getUser's data.user; only `.id` (= JWT `sub`) is consumed
// downstream (org/role/status are loaded fresh from the DB, never trusted from
// the token).
//
// Safety: on ANY local-verify failure (secret absent or wrong, asymmetric-key
// project where alg !== HS256, bad signature, expired token) it falls back to
// the proven remote getUser path — so behaviour is never worse than before. A
// genuinely invalid/expired token still fails: local throws, remote rejects,
// 401. A misconfigured secret degrades to no-speedup, not breakage.
export async function verifyToken(token) {
    if (SUPABASE_JWT_SECRET) {
        try {
            const payload = jwt.verify(token, SUPABASE_JWT_SECRET, {
                algorithms: ['HS256'],
            });
            if (payload?.sub) {
                return { id: payload.sub, email: payload.email };
            }
        } catch {
            // fall through to remote verification
        }
    }
    const { data, error } = await serviceClient.auth.getUser(token);
    if (error || !data.user)
        throw new Error('Invalid token');
    return data.user;
}
