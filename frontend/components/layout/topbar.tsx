'use client';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { GlobalRefresh } from '@/components/layout/global-refresh';
import { useSidebar, HamburgerIcon } from '@/components/layout/sidebar-context';
import { AgencySwitcher } from '@/features/agency/components/AgencySwitcher';
import { exitSwitch } from '@/features/agency/api';

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
  const { collapsed, toggle } = useSidebar();

  // Clear the session cookie server-side, then return to the login page.
  async function signOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-10">
      {/* Agency switch banner — persistent while acting inside a sub-account. */}
      {me?.agency?.switched && (
        <div className="flex items-center justify-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-900">
          <span>
            Viewing <strong>{me.organisation_name}</strong> as {me.agency.home_org?.name || 'agency'}
          </span>
          <button type="button" onClick={() => exitSwitch()} className="font-semibold underline">
            Exit
          </button>
        </div>
      )}
    <header className="h-14 bg-card border-b border-border px-6 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {collapsed && (
          <button
            onClick={toggle}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="shrink-0 w-9 h-9 -ml-2 rounded-lg text-ink-muted hover:text-brand hover:bg-bg flex items-center justify-center transition"
          >
            <HamburgerIcon />
          </button>
        )}
        <span className="font-medium text-ink truncate">{me?.organisation_name ?? ''}</span>
        <AgencySwitcher />
      </div>
      <div className="flex items-center gap-3">
        <GlobalRefresh />
        <NotificationBell />
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
    </div>
  );
}
