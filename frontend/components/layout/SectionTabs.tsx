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
    // Full-bleed against the content area's padding so the hairline runs the
    // width of the page, the way a tab strip reads in a desktop app. <main> is
    // the scroll container, so sticking to its top keeps the section's other
    // screens one click away however far down a long page the reader is.
    <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 border-b border-border bg-card">
      <div
        ref={scrollerRef}
        className="flex items-stretch gap-1 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const active = routeId === item.id;
          return (
            <Link
              key={item.id}
              href={`/${item.id}`}
              ref={active ? activeRef : undefined}
              aria-current={active ? 'page' : undefined}
              className={`group relative shrink-0 whitespace-nowrap px-3 pt-3.5 pb-3 text-[13px] transition-colors duration-150 ${
                active ? 'font-semibold text-brand' : 'font-medium text-ink-muted hover:text-ink'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                {item.isNew && (
                  <span
                    className={`rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide transition-colors ${
                      active ? 'bg-brand-50 text-brand' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    New
                  </span>
                )}
              </span>
              {/* The underline sits on the strip's own border line. It is always
                  rendered and only scaled, so moving between tabs animates
                  rather than popping in and out. */}
              <span
                className={`absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-brand transition-transform duration-200 ${
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
