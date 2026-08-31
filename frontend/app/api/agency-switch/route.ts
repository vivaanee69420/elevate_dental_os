// Sets/clears the agency-switch cookie. The signed token comes from the
// backend (which validates child-of-agency); this route only moves it into
// an httpOnly cookie on OUR origin so client JS never sees it — mirroring
// the login route's cookie handling. The generic backend proxy re-injects it
// as x-agency-switch on every request.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export const dynamic = 'force-dynamic';

const COOKIE = 'agency_switch';
const MAX_AGE = 12 * 60 * 60; // seconds — matches the token TTL

export async function POST(req: NextRequest) {
  const supabase = getSupabaseRoute();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.text();
  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/api/agency/switch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable.' }, { status: 502 });
  }
  const text = await backendRes.text();
  const res = new NextResponse(text, {
    status: backendRes.status,
    headers: { 'Content-Type': backendRes.headers.get('content-type') || 'application/json' },
  });
  if (backendRes.ok) {
    try {
      const { token } = JSON.parse(text) as { token: string };
      res.cookies.set(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: MAX_AGE,
      });
    } catch {
      // malformed backend body — return it as-is without a cookie
    }
  }
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
