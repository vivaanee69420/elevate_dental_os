'use client';

// The always-on / open-days page filter.
//
// An open day is a named EVENT that a handful of campaigns promote, and its
// economics are nothing like an always-on campaign's: a burst of spend before
// a date, a rush of leads around it, then nothing. Blended together they
// average into a number that describes neither. This filter lets the reader
// ask for one or the other and have EVERY figure on the page — cards,
// per-practice rows, all four tabs, and the leads behind a card — answer for
// the same population.
//
// WHY THE SERVER DOES THE FILTERING and this component only names the bucket:
// the partition rule (spend's event comes from its Meta campaign, a lead's
// from its GoHighLevel pipeline) lives once, in
// backend/src/lib/marketing/open-days.js. Re-deriving it in five components
// here would be five chances to disagree about what an open day is.
//
// Split the same way AdReportTabs is: a presentational row with no router
// dependency, plus a hook that owns the `?bucket=` URL sync, so the view is
// shareable and the back button works like every other filter on the page.
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type AdBucket = 'all' | 'alwaysOn' | 'openDays';

const OPTIONS: { id: AdBucket; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'alwaysOn', label: 'Always-on' },
  { id: 'openDays', label: 'Open days' },
];

export function AdBucketFilter({
  value,
  onChange,
}: {
  value: AdBucket;
  onChange: (b: AdBucket) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Campaign type"
      className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface p-1"
    >
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            // Never colour alone: the selected pill also carries the weight
            // change and the filled background, so the state survives a
            // greyscale print and a colour-blind reader.
            className={`rounded-full px-3.5 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
              active
                ? 'bg-brand font-semibold text-white'
                : 'font-medium text-ink-muted hover:bg-bg hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Reads the bucket from `?bucket=`, and keeps it honest.
 *
 * `available` is whether this tenant maps any campaign or pipeline to an
 * event at all. When it is false the filter has nothing to divide, so the
 * hook reports 'all' and STRIPS the param — a URL that names a bucket the
 * page cannot honour must not claim a filter that isn't applied, the same
 * rule FacebookReportScreen already enforces for campaignId/adSetId.
 *
 * `pending` holds that correction while the query that decides `available` is
 * still in flight, so a shared `?bucket=openDays` link is not rewritten to
 * 'all' on the first render — exactly the bug useAdReportTab's own `pending`
 * flag exists to prevent for `?tab=`.
 */
export function useAdBucket(
  { available, pending = false }: { available: boolean; pending?: boolean },
): [AdBucket, (b: AdBucket) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const requested = params.get('bucket');
  const recognised = OPTIONS.some((o) => o.id === requested) ? (requested as AdBucket) : 'all';
  const active: AdBucket = available ? recognised : 'all';

  const setActive = useCallback(
    (b: AdBucket) => {
      const sp = new URLSearchParams(params.toString());
      // 'all' is the default, so it is expressed by the param's ABSENCE
      // rather than by `bucket=all` — a clean URL to share, and one fewer
      // value to keep in step with the server's own default.
      if (b === 'all') sp.delete('bucket');
      else sp.set('bucket', b);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (pending) return;
    // Only ever REMOVES a param the page cannot honour. It never writes one,
    // so the default view's URL stays clean.
    if (requested !== null && active === 'all') setActive('all');
  }, [pending, requested, active, setActive]);

  return [active, setActive];
}
