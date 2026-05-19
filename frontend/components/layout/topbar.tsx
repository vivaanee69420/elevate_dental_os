'use client';
import { useRouter } from 'next/navigation';
import { ORG_NAME } from '@/features/_mock';
import { useMe } from '@/hooks/useMe';

// TopBar — app shell header. Mirrors the preview prototype's .topbar:
// org name on the left, user avatar + sign out on the right.
// Frozen Phase-0 primitive.

/** Build initials from a name or email, e.g. "Gaurav Mehta" -> "GM".
 *  /auth/me has no full_name, so fall back to email; never crash on undefined. */
function initials(name?: string): string {
  const src = (name || '').trim();
  if (!src) return '?';
  return src
    .split(/[\s@.]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TopBar() {
  const router = useRouter();
  const { data: me } = useMe();

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
            {initials(me.full_name || me.email)}
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
