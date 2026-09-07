'use client';

// The tab strip shared by every ad-reporting page — Facebook gets three tabs,
// Google gets four, and both must treat "the active tab" identically or the
// two pages drift on shareability/back-button behaviour.
//
// Split into two exports on purpose:
//   - `AdReportTabs` is a plain presentational button row (tabs/active/
//     onChange props only) with no router dependency, so it renders and can
//     be reasoned about without a Next.js router context.
//   - `useAdReportTab` owns the `?tab=` URL sync (useRouter/useSearchParams)
//     that makes a tab view shareable and makes the back button work. Both
//     Facebook's and Google's pages call this SAME hook rather than each
//     hand-rolling their own URL glue, which is the whole point of putting
//     it here before either page exists.
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type AdReportTab = { id: string; label: string };

export function AdReportTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: AdReportTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 border-b border-border">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            // Active vs inactive is never colour alone: the underline
            // (border-b-2, present or transparent) and the font weight both
            // change alongside the ink/ink-muted text colour.
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              isActive
                ? 'border-ink font-semibold text-ink'
                : 'border-transparent font-medium text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// Reads the current tab from `?tab=`, defaulting to the first tab when the
// param is absent or names a tab that isn't in `tabs`; returns a setter that
// writes the id back with `router.replace` (not `push`, so switching tabs
// doesn't spam browser history) — same pattern as the dataset pill row in
// DataRoomScreen and the ScopePeriod engine in features/_shared/scope-context.
//
// `pending` says the tab LIST is not final yet — Facebook's Open days tab
// only exists once the performance query says this tenant runs open days.
// While it is true the URL is left exactly as the reader wrote it: without
// this, a bookmarked ?tab=opendays was rewritten to ?tab=campaigns on the
// first render, before the data that would have recognised it arrived, so the
// tab could never be reloaded or shared. The page still RENDERS the fallback
// tab meanwhile; only the rewrite waits.
export function useAdReportTab(
  tabs: AdReportTab[],
  { pending = false }: { pending?: boolean } = {},
): [string, (id: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const requested = params.get('tab');
  const active = tabs.find((t) => t.id === requested)?.id ?? tabs[0]?.id ?? '';

  const setActive = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('tab', id);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Absent or unrecognised ?tab= resolves silently to the first tab so the
  // page still renders correctly; this backfills the URL itself so a shared
  // or bookmarked link always names the tab actually shown.
  useEffect(() => {
    if (pending) return;
    if (active && requested !== active) setActive(active);
  }, [pending, active, requested, setActive]);

  return [active, setActive];
}
