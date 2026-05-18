'use client';
import { supabase } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export function TopBar() {
  const router = useRouter();
  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }
  return (
    <header className="bg-card border-b border-border px-6 py-3 flex justify-between items-center">
      <div></div>
      <button onClick={signOut} className="text-sm text-ink-muted hover:text-ink">Sign out</button>
    </header>
  );
}
