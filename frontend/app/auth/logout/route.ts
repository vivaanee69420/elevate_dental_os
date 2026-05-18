import { NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = getSupabaseRoute();
  await supabase.auth.signOut(); // cookie adapter clears httpOnly session cookies
  return NextResponse.json({ success: true });
}
