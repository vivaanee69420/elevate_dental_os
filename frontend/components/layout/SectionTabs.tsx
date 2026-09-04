'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { visibleNavSections, type Permissions } from '@/lib/permissions';
import { sectionForRoute } from '@/lib/nav';
import { useMe } from '@/hooks/useMe';

// SectionTabs — the screens of the active sidebar section, as one underlined
// tab strip at the top of the content area.
//
// The sidebar lists sections only; this strip is how a section's screens are
// reached, so it renders even for a one-screen section — dropping it there
// would leave that screen with no visible place in the navigation.
//
// Long sections (Overview carries twelve screens) scroll horizontally inside
// this strip rather than wrapping, and the active tab is scrolled into view on
// load so the current screen is never parked off-strip.

export function SectionTabs() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const permissions: Permissions | null = me?.permissions ?? null;
  const activeRef = useRef<HTMLAnchorElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const routeId = (pathname || '/').replace(/^\//, '').split('/')[0];
  const section = sectionForRoute(routeId);

  const items =
    (section &&
      visibleNavSections(me?.role, permissions, me?.features).find((s) => s.label === section.label)
        ?.items) ||
    [];

  // Bring the active tab into view without scrolling the page itself —
  // scrollIntoView would drag the whole content area up on a deep page, so the
  // scroller's own offset is set directly.
  useEffect(() => {
    const el = activeRef.current;
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const target = el.offsetLeft - (scroller.clientWidth - el.clientWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
  }, [routeId, items.length]);

  if (!section || items.length === 0) return null;

  return (
    // Rendered above <main>, so it is already flush under the topbar and spans
    // the full width — the white continues the topbar's surface and one
    // hairline closes the header block.
    <div className="shrink-0 border-b border-border bg-card">
      <div
        ref={scrollerRef}
        className="flex h-11 items-stretch gap-0.5 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const active = routeId === item.id;
          return (
            <Link
              key={item.id}
              href={`/${item.id}`}
              ref={active ? activeRef : undefined}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex shrink-0 items-center whitespace-nowrap px-3 text-[13px] transition-colors duration-150 ${
                active ? 'font-semibold text-brand' : 'font-medium text-ink-muted hover:text-ink'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                {/* A dot, not a NEW pill: a row of pills was louder than the
                    tab labels themselves and buried the active tab. */}
                {item.isNew && (
                  <span
                    aria-label="New"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                  />
                )}
              </span>
              {/* The underline sits on the strip's own border line. It is always
                  rendered and only scaled, so moving between tabs animates
                  rather than popping in and out. */}
              <span
                className={`absolute inset-x-2 bottom-0 h-0.5 origin-center rounded-t-full bg-brand transition-transform duration-200 ${
                  active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100 group-hover:bg-border'
                }`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
