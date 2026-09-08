'use client';

import { platformLogout } from '@/lib/platform-api';
import { leaveSession } from '@/lib/session-boundary';

export function PlatformLogoutButton() {
  return (
    <button
      type="button"
      className="w-full text-left text-sm text-ink-muted hover:text-ink"
      onClick={async () => {
        await platformLogout();
        // Full document navigation — see lib/session-boundary.ts. This one
        // matters most: the superadmin console's cache holds other tenants'
        // organisations, and a client-side push would leave it in memory for
        // whoever signs in next on this machine.
        leaveSession('/login');
      }}
    >
      Sign out
    </button>
  );
}
