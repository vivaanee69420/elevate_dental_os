'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ORG_NAME } from '@/features/_mock';

// TopBar — app shell header. Mirrors the preview prototype's .topbar:
// org name on the left, user avatar + sign out on the right.
// Frozen Phase-0 primitive.

interface Me {
  full_name: string;
}

/** Build initials from a full name, e.g. "Gaurav Mehta" -> "GM". */
function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TopBar() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  // Load the signed-in user once for the avatar initials.
  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  // Clear the session cookie server-side, then return to the login page.
  async function signOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="h-14 bg-card border-b border-border px-6 flex items-center justify-between sticky top-0 z-10">
      <span className="font-medium text-ink">{ORG_NAME}</span>
      <div className="flex items-center gap-3">
        {me && (
          <div className="w-7 h-7 rounded-full bg-brand-50 text-brand flex items-center justify-center text-[11px] font-semibold">
            {initials(me.full_name)}
          </div>
        )}
        <button
          onClick={signOut}
          className="text-sm text-ink-muted hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
