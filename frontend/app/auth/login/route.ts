import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const PLATFORM_COOKIE = 'platform_token';
const PLATFORM_COOKIE_MAX_AGE = 8 * 60 * 60; // matches the 8h platform JWT

// ============================================================================
// Unified login. ONE page, ONE route — but the two auth systems stay isolated:
// a tenant gets a Supabase session cookie, a platform superadmin gets the
// separate platform_token cookie (different signing secret + table entirely).
//
//   POST /auth/login
//     │
//     ├─ 1. backend /auth/login  (tenant: validate creds + approval gate)
//     │      ok   -> supabase signin -> sb cookie -> redirect /dashboard
//     │      401  -> ambiguous creds -> step 2
//     │      403/409/429/5xx -> return verbatim (NOT a platform probe)
//     │
//     └─ 2. backend /api/platform/login  (bcrypt vs platform_admins)
//            ok   -> platform_token cookie -> redirect /platform/overview
//            else -> generic 401 (never reveal which store the email is in)
//
// SECURITY: these calls run server-side, so the backend would otherwise see
// THIS server's IP for everyone, collapsing the per-IP login rate-limiters to
// a single global bucket. We forward the real client IP as X-Forwarded-For
// (backend has `trust proxy`) so brute-force limits key per client.
// ============================================================================

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const ip = clientIp(req);
  const fwd: Record<string, string> = ip ? { 'x-forwarded-for': ip } : {};
  const jsonBody = JSON.stringify({ email, password });

  // ---- 1. Tenant login (credentials + approval/provisioning gate) ----------
  let tenantRes: Response;
  try {
    tenantRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fwd },
      body: jsonBody,
    });
  } catch {
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL configuration.' },
      { status: 502 },
    );
  }

  if (tenantRes.ok) {
    // Establish the httpOnly Supabase session cookie.
    const supabase = getSupabaseRoute();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return NextResponse.json({ error: 'Sign in failed' }, { status: 401 });
    }
    return NextResponse.json({ success: true, redirect: '/business-hub' });
  }

  // Only a plain 401 (unknown / wrong tenant credentials) is ambiguous enough
  // to be "maybe a platform admin". Approval gate (403), conflicts (409),
  // rate-limit (429) and backend errors are returned as-is — falling through
  // would let those states probe / hammer the platform login path.
  if (tenantRes.status !== 401) {
    const data = await tenantRes.json().catch(() => ({ error: 'Sign in failed' }));
    return NextResponse.json(
      { error: data.error || 'Sign in failed' },
      { status: tenantRes.status },
    );
  }

  // ---- 2. Platform-admin fallback ------------------------------------------
  let platformRes: Response;
  try {
    platformRes = await fetch(`${BACKEND_URL}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fwd },
      body: jsonBody,
    });
  } catch {
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL configuration.' },
      { status: 502 },
    );
  }

  if (platformRes.ok) {
    const data = await platformRes.json().catch(() => ({}));
    if (!data?.token) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    const res = NextResponse.json({ success: true, redirect: '/platform/overview' });
    res.cookies.set(PLATFORM_COOKIE, data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: PLATFORM_COOKIE_MAX_AGE,
    });
    return res;
  }

  // Neither store accepted. Generic message — do not echo the platform-side
  // error or otherwise reveal that the email is (or isn't) a platform admin.
  return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
}
