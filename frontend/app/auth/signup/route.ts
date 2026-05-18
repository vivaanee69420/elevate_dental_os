import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

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
  const res = await fetch(`${BACKEND_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name, organisation_name }),
  });
  const data = await res.json().catch(() => ({ error: 'Signup failed' }));
  if (!res.ok) {
    return NextResponse.json({ error: data.error || 'Signup failed' }, { status: res.status });
  }

  // 2. Sign in server-side → httpOnly session cookies.
  const supabase = getSupabaseRoute();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
