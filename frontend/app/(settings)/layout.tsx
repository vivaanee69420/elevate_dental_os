import { Suspense } from 'react';
import { SettingsRail } from '@/components/layout/SettingsRail';
import { SettingsTopBar } from '@/components/layout/SettingsTopBar';
import { SyncToastProvider } from '@/features/integrations/sync-toast';

// Settings is its own shell. The dashboard sidebar, topbar and section tab
// strip live in app/(dashboard)/layout.tsx, so they simply never wrap these
// routes — "hide the rest of the product" is layout nesting, not a conditional
// inside a shared shell that the two could drift apart on.
//
// Route groups do not appear in the URL: /integrations, /data-hub,
// /team-permissions and /settings are unchanged, so every existing link into
// them keeps working and nothing needs a redirect.
//
// Integrations lives in this shell and drives the sync-progress overlay
// through useSyncToast(). That hook returns a no-op default when no provider
// is present, so omitting this breaks the overlay SILENTLY — no type error,
// no build error, just a sync that gives the user no sign it is running.
//
// Residual: the dashboard and settings shells are separate React trees, so a
// toast started here will not survive navigating into the dashboard the way
// it did when Integrations lived inside app/(dashboard)/layout.tsx. Hoisting
// SyncToastProvider to the root layout would restore that; not done here.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SyncToastProvider>
        <div className="min-h-screen flex bg-bg">
          <SettingsRail />
          <div className="flex-1 flex flex-col min-w-0">
            <SettingsTopBar />
            <main className="flex-1 p-6 overflow-y-auto">{children}</main>
          </div>
        </div>
      </SyncToastProvider>
    </Suspense>
  );
}
