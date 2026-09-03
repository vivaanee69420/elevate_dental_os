'use client';
// Ads for one ad set, expanded in place beneath its row (FacebookAdSetsScreen
// renders one of these per ad-set row). `useFacebookAds(adSetId, expanded)` is
// called unconditionally on every render — only its `enabled` flag moves —
// so React's hook-order rule holds and a collapsed row still fires no request
// (Task 5's hook gates the query on `enabled`, not this component).
//
// One data path, not two: `useFacebookAds` is a useInfiniteQuery (hooks.ts) —
// it owns paging, cursor, and the since/until/practice_id query string
// end to end. This component never builds a query string or calls the API
// directly, so there is exactly one copy of the DST-correct London-date
// conversion in this feature (hooks.ts), not a second one drifting here.
import { useFacebookAds } from '../hooks';
import type { FacebookRow } from '../api';
import { formatPence } from '@/lib/format';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
// null when there were no impressions/clicks to divide by — unknowable, not zero.
const ctrPct = (ctr: number | null) => (ctr === null ? '—' : `${(ctr * 100).toFixed(2)}%`);
const num = (n: number) => n.toLocaleString('en-GB');

const TD = 'px-4 py-2.5 text-right tabular-nums';
// Name, Spend, Impressions, Clicks, CTR, CPC, Reach(blank at this tier),
// Leads, Booked, Attended, Patients, CPL, CPB, CPA — same 14 columns as the
// ad-set table this renders inside, so every row lines up under its header.
const COLS = 14;

function AdRow({ ad }: { ad: FacebookRow }) {
  return (
    <tr className="border-t border-border bg-bg">
      <td className="px-4 py-2.5 pl-10 text-ink-muted">{ad.name ?? ad.id ?? 'Unnamed ad'}</td>
      <td className={TD}>{money(ad.spendPence)}</td>
      <td className={TD}>{num(ad.impressions)}</td>
      <td className={TD}>{num(ad.clicks)}</td>
      <td className={TD}>{ctrPct(ad.ctr)}</td>
      <td className={TD}>{money(ad.cpcPence)}</td>
      {/* No reach at ad tier — Meta does not return it below ad set. */}
      <td className={TD}>—</td>
      <td className={TD}>{num(ad.leads)}</td>
      <td className={TD}>{num(ad.booked)}</td>
      <td className={TD}>{num(ad.attended)}</td>
      <td className={TD}>{num(ad.patients)}</td>
      <td className={TD}>{money(ad.cplPence)}</td>
      <td className={TD}>{money(ad.cpbPence)}</td>
      <td className={TD}>{money(ad.cpaPence)}</td>
    </tr>
  );
}

export function FacebookAdRows({ adSetId, expanded }: { adSetId: string; expanded: boolean }) {
  const {
    data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useFacebookAds(adSetId, expanded);

  if (!expanded) return null;

  if (isLoading) {
    return (
      <tr className="border-t border-border bg-bg">
        <td colSpan={COLS} className="px-4 py-2.5 pl-10 text-[13px] text-ink-muted">Loading ads…</td>
      </tr>
    );
  }
  if (isError) {
    return (
      <tr className="border-t border-border bg-bg">
        <td colSpan={COLS} className="px-4 py-2.5 pl-10 text-[13px] text-danger">
          {`Couldn't load ads: ${(error as Error)?.message ?? 'unknown error'}`}
        </td>
      </tr>
    );
  }

  const ads = data?.pages.flatMap((p) => p.rows) ?? [];

  if (ads.length === 0 && !hasNextPage) {
    return (
      <tr className="border-t border-border bg-bg">
        <td colSpan={COLS} className="px-4 py-2.5 pl-10 text-[13px] text-ink-muted">
          No ads with spend in this window.
        </td>
      </tr>
    );
  }

  return (
    <>
      {ads.map((ad, i) => <AdRow key={ad.id ?? `${adSetId}-ad-${i}`} ad={ad} />)}
      {hasNextPage && (
        <tr className="border-t border-border bg-bg">
          <td colSpan={COLS} className="px-4 py-2.5 pl-10">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="rounded-lg border border-border bg-surface px-3 py-1 text-[12.5px] text-ink-muted hover:bg-bg disabled:opacity-50"
            >
              {isFetchingNextPage ? 'Loading…' : 'Show more ads'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
