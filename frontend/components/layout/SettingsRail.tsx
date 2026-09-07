'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import { canAccessRoute, featureAllowsSection } from '@/lib/permissions';

// The Settings menu. Each row names the route id it is gated by, so the rail
// uses exactly the permission the page itself uses — no second list of rules
// to fall out of step with lib/permissions.ts.
export const SETTINGS_ITEMS: { href: string; label: string; routeId: string }[] = [
  // No separate Roles page: access is granted per PERSON, a tab at a time,
  // inside the Team editor. A role-wide matrix beside it would be a second
  // place answering the same question, free to disagree with the first.
  { href: '/team-permissions', label: 'Team', routeId: 'team-permissions' },
  { href: '/integrations', label: 'Integrations', routeId: 'integrations' },
  { href: '/data-hub', label: 'Data Hub', routeId: 'data-hub' },
  { href: '/settings/billing', label: 'Billing', routeId: 'settings' },
];

export function SettingsRail() {
  const pathname = usePathname();
  const { data: me } = useMe();

  const allowed = featureAllowsSection('Settings', me?.features)
    ? SETTINGS_ITEMS.filter((i) => canAccessRoute(i.routeId, me?.permissions))
    : [];

  // Sub-accounts is the agency administering its clients, not the tenant
  // administering itself, so it hangs off the per-user agency grant and not
  // off a permission key. It is appended OUTSIDE the Settings feature filter
  // deliberately: an agency actor switched into a sub-account that has the
  // Settings module turned off must still be able to turn it back on — the
  // backend already lets agency actors past module gates for the same reason.
  const items = isAgencyActor(me)
    ? [...allowed, { href: '/settings/sub-accounts', label: 'Sub-accounts', routeId: 'settings' }]
    : allowed;

  return (
    <aside className="w-64 shrink-0 bg-card h-screen sticky top-0 flex flex-col border-r border-border">
      <div className="p-3 border-b border-border">
        <Link
          href="/business-hub"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-bg hover:text-ink transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Go Back
        </Link>
      </div>

      <div className="px-6 pt-5 pb-2">
        <h2 className="font-display text-lg font-semibold text-ink">Settings</h2>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 ${
                active
                  ? 'bg-brand-50 font-semibold text-brand'
                  : 'font-medium text-ink-muted hover:bg-bg hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {items.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-ink-muted">
            You do not have access to any settings.
          </p>
        )}
      </nav>
    </aside>
  );
}
