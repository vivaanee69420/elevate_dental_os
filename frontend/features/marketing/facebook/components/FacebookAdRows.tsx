'use client';
// Ads for one ad set, expanded in place beneath its row (FacebookAdSetsScreen
// renders one of these per ad-set row). `useFacebookAds(adSetId, expanded)` is
// called unconditionally on every render — only its `enabled` flag moves —
// so React's hook-order rule holds and a collapsed row still fires no request
// (Task 5's hook gates the query on `enabled`, not this component).
//
// Task 5's hook only ever fetches the FIRST page: its query key carries no
// cursor, so it cannot itself page through "Show more" clicks. Those extra
// pages are fetched directly via `fetchFacebookAds`, built with a since/until
// qs that mirrors hooks.ts's private `facebookWindowParams` (not exported —
// and hooks.ts is under a concurrent read-only review this session, so it
// cannot be touched to export it). Duplicating the handful of lines of pure,
// deterministic London-date math below is the contained cost of that; a
// follow-up should export the helper instead of two copies existing.
import { useState } from 'react';
import { formatPence } from '@/lib/format';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useFacebookAds } from '../hooks';
import { fetchFacebookAds, type FacebookRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
// null when there were no impressions/clicks to divide by — unknowable, not zero.
const ctrPct = (ctr: number | null) => (ctr === null ? '—' : `${(ctr * 100).toFixed(2)}%`);
const num = (n: number) => n.toLocaleString('en-GB');

const TD = 'px-4 py-2.5 text-right tabular-nums';
// Name, Spend, Impressions, Clicks, CTR, CPC, Reach(blank at this tier),
// Leads, Booked, Attended, Patients, CPL, CPB, CPA — same 14 columns as the
// ad-set table this renders inside, so every row lines up under its header.
const COLS = 14;

// Duplicated from hooks.ts (see file header) — kept private to this file.
const LONDON_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});
function londonDateOf(iso: string): string {
  return LONDON_DATE.format(new Date(iso));
}
function lastInclusiveLondonDay(exclusiveUntilIso: string): string {
  const [y, m, d] = londonDateOf(exclusiveUntilIso).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}
function practiceOf(scope: string | null | undefined): string | null {
  return scope && scope !== 'all' ? scope : null;
}
function adsQs(scope: string, win: { since: string; until: string }, cursor: string): string {
  const sp = new URLSearchParams();
  sp.set('since', londonDateOf(win.since));
  sp.set('until', lastInclusiveLondonDay(win.until));
  const practiceId = practiceOf(scope);
  if (practiceId) sp.set('practice_id', practiceId);
  sp.set('cursor', cursor);
  return sp.toString();
}

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
  const { scope, win } = useScopePeriod();
  const { data, isLoading, isError, error } = useFacebookAds(adSetId, expanded);

  // Extra ("Show more") pages live outside react-query, keyed to the ad set +
  // scope/window this render is for. When that key changes — a different row
  // opened, or the shared scope/period bar moved — reset synchronously so a
  // stale accumulated page never gets attached to a new window's first page.
  const key = `${adSetId}:${scope}:${win.since}:${win.until}`;
  const [pageState, setPageState] = useState<{ key: string; extra: FacebookRow[]; cursor: string | null }>({
    key, extra: [], cursor: null,
  });
  if (pageState.key !== key) {
    setPageState({ key, extra: [], cursor: null });
  }
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

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

  const firstPage = data?.rows ?? [];
  const ads = [...firstPage, ...pageState.extra];
  // The cursor for the NEXT fetch: once we've paged at least once, it's the
  // cursor the last manual fetch returned; before that, it's the hook's own
  // first-page cursor (still stale-safe — `key` resets `extra`/`cursor`
  // together whenever the window/scope this cursor was issued for changes).
  const nextCursor = pageState.extra.length > 0 ? pageState.cursor : (data?.nextCursor ?? null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchFacebookAds(adSetId, adsQs(scope, win, nextCursor));
      setPageState((prev) => ({ key: prev.key, extra: [...prev.extra, ...page.rows], cursor: page.nextCursor }));
    } catch (e) {
      setMoreError((e as Error)?.message ?? 'unknown error');
    } finally {
      setLoadingMore(false);
    }
  }

  if (ads.length === 0 && !nextCursor) {
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
      {moreError && (
        <tr className="border-t border-border bg-bg">
          <td colSpan={COLS} className="px-4 py-2.5 pl-10 text-[13px] text-danger">
            {`Couldn't load more ads: ${moreError}`}
          </td>
        </tr>
      )}
      {nextCursor && (
        <tr className="border-t border-border bg-bg">
          <td colSpan={COLS} className="px-4 py-2.5 pl-10">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-border bg-surface px-3 py-1 text-[12.5px] text-ink-muted hover:bg-bg disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Show more ads'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
