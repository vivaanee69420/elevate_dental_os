// Stores which of the caller's accounts they are acting in.
//
// Unlike the agency switch, no signed token is needed: the backend authorises
// this against the membership table on every request, so the cookie only has
// to carry the choice. It is httpOnly all the same — client JS has no reason
// to read it, and the generic proxy replays it as x-active-org.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export const dynamic = 'force-dynamic';

const COOKIE = 'active_org';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days — a working preference, not a credential

export async function POST(req: NextRequest) {
  const supabase = getSupabaseRoute();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.text();
  let backendRes: Response;
  try {
    // The backend confirms a membership exists before we store anything.
    backendRes = await fetch(`${BACKEND_URL}/auth/switch-org`, {
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
      const { organisation_id } = JSON.parse(text) as { organisation_id: string };
      res.cookies.set(COOKIE, organisation_id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: MAX_AGE,
      });
    } catch {
      // Malformed body — return it as-is rather than storing a bad choice.
    }
  }
  return res;
}

/** Clear the choice and fall back to the login's home account. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
