'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleNavSections, type Permissions } from '@/lib/permissions';
import { sectionForRoute } from '@/lib/nav';
import { useMe } from '@/hooks/useMe';

// SectionTabs — horizontal sub-navigation for the active sidebar section.
// Mirrors the prototype's per-section tab bar: every screen in the current
// section sits in one pill row, active filled, others outlined. Visibility
// per tab respects the same RBAC keys the sidebar uses.

export function SectionTabs() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const permissions: Permissions | null = me?.permissions ?? null;

  const routeId = (pathname || '/').replace(/^\//, '').split('/')[0];
  const section = sectionForRoute(routeId);
  if (!section) return null;

  const items =
    visibleNavSections(me?.role, permissions).find((s) => s.label === section.label)?.items ?? [];
  if (items.length <= 1) return null;

  return (
    <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-brand" />
        <span className="text-[11px] uppercase tracking-wider font-semibold text-brand">
          {section.label} <span className="text-ink-muted">section</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = routeId === item.id;
          return (
            <Link
              key={item.id}
              href={`/${item.id}`}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium border transition ${
                active
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-card text-ink border-border hover:border-brand hover:text-brand'
              }`}
            >
              <span>{item.label}</span>
              {item.isNew && (
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 ${
                    active ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  New
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
