import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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

  // Validate credentials AND the provisioning gate via the backend first.
  // The backend returns JSON { error } with 401 (bad credentials), 403
  // ("Account not provisioned. Contact your administrator.") or 409
  // ("An account with this email already exists"). Pass that text straight
  // through so the login page can surface it verbatim.
  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL configuration.' },
      { status: 502 },
    );
  }
  if (!backendRes.ok) {
    const data = await backendRes
      .json()
      .catch(() => ({ error: 'Sign in failed' }));
    return NextResponse.json(
      { error: data.error || 'Sign in failed' },
      { status: backendRes.status },
    );
  }

  // Backend accepted the account; now establish the httpOnly cookie session.
  const supabase = getSupabaseRoute();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  // Session cookies (httpOnly) set by the cookie adapter during signIn.
  return NextResponse.json({ success: true });
}
