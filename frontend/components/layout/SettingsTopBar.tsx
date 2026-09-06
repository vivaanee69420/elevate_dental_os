'use client';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { exitSwitch } from '@/features/agency/api';

// The settings shell's header. Deliberately not the dashboard TopBar: that one
// carries a hamburger that toggles a sidebar which does not exist here. What
// must survive is the agency-switch banner — losing it inside Settings would
// let someone administer a sub-account's team believing it was their own.
export function SettingsTopBar() {
  const router = useRouter();
  const { data: me } = useMe();

  async function signOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-10">
      {me?.agency?.switched && (
        <div className="flex items-center justify-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-900">
          <span>
            Viewing <strong>{me.organisation_name}</strong> as{' '}
            {me.agency.home_org?.name || 'agency'}
          </span>
          <button type="button" onClick={() => exitSwitch()} className="font-semibold underline">
            Exit
          </button>
        </div>
      )}
      <header className="h-14 bg-card border-b border-border px-6 flex items-center justify-between">
        <span className="font-display text-[15px] font-semibold text-ink truncate">
          {me?.organisation_name || 'Settings'}
        </span>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <button
            type="button"
            onClick={signOut}
            className="text-[13px] font-medium text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>
    </div>
  );
}
