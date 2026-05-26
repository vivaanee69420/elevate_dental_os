import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    full_name?: string;
    organisation_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { email, password, full_name, organisation_name } = body;
  if (!email || !password || !full_name || !organisation_name) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  // 1. Create account via backend (org + owner user + seed plans).
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name, organisation_name }),
    });
  } catch {
    // Backend unreachable (e.g. BACKEND_URL unset → localhost in a deployed
    // container). Surface a clear 502 instead of an opaque Next 500.
    return NextResponse.json(
      { error: 'Backend unreachable. Check BACKEND_URL configuration.' },
      { status: 502 }
    );
  }
  const data = await res.json().catch(() => ({ error: 'Signup failed' }));
  if (!res.ok) {
    return NextResponse.json({ error: data.error || 'Signup failed' }, { status: res.status });
  }

  // 2. Do NOT sign in. A public signup creates an owner with status 'pending'
  // (backend), and login is hard-blocked (403) until a platform superadmin
  // approves. Auto-signing-in here would mint a Supabase session and hand the
  // user the dashboard, bypassing the entire approval gate. Instead we return
  // 'pending' so the UI shows a "waiting for approval" screen.
  return NextResponse.json({ success: true, pending: true, status: data.status ?? 'pending' });
}
