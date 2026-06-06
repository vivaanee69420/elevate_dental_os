'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlatformLogoutButton } from '@/components/platform/PlatformLogoutButton';

// PlatformSidebar — the platform (SaaS-owner) shell's primary navigation.
//
// Styled to match the tenant app shell (components/layout/sidebar.tsx): white
// surface, brand logo tile, brand-50 active state. Two deliberate differences
// keep "cross-tenant god-mode" unmistakable at a glance:
//   1. a danger-tinted PLATFORM pill under the logo, and
//   2. a topbar accent strip (see PlatformTopBar).
//
// Unlike the app sidebar there is NO permission gating here: platform is a
// single superadmin tier, so the nav is a flat static list. Sensitive actions
// stay backend-gated (requirePlatformRole on the routes).

const NAV = [
  { href: '/platform/overview', label: 'Overview' },
  { href: '/platform/orgs', label: 'Organisations' },
  { href: '/platform/signups', label: 'Signups' },
  { href: '/platform/users', label: 'Users' },
  { href: '/platform/audit', label: 'Audit log' },
  { href: '/platform/integrations', label: 'Integrations' },
  { href: '/platform/courses', label: 'Courses' },
];

export function PlatformSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-card border-r border-border h-screen sticky top-0 overflow-y-auto flex flex-col">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-brand text-white flex items-center justify-center font-display font-bold">
          E
        </div>
        <Link href="/platform/overview" className="font-display text-lg font-semibold text-ink">
          Elevate <span className="text-ink-muted font-normal">Platform</span>
        </Link>
      </div>

      <div className="px-3 pt-3">
        <span className="inline-block bg-danger/10 text-danger text-[11px] uppercase tracking-widest font-semibold rounded px-2 py-0.5">
          Platform
        </span>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`block px-4 py-2 text-sm rounded-lg transition ${
                active
                  ? 'bg-brand-50 text-brand font-medium'
                  : 'text-ink-muted hover:bg-bg hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <PlatformLogoutButton />
      </div>
    </aside>
  );
}
