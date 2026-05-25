'use client';

import { useRouter } from 'next/navigation';
import { platformLogout } from '@/lib/platform-api';

export function PlatformLogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="w-full text-left text-sm text-ink-muted hover:text-ink"
      onClick={async () => {
        await platformLogout();
        router.push('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
