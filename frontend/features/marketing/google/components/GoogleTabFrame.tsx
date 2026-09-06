'use client';
// ============================================================================
// The chrome every Google grain tab wears: the tenant-state notice, the
// window-clamp footnote, the excluded-accounts footnote and the "show more"
// button.
//
// Extracted because all five tabs carried a verbatim copy of it. That is four
// chances to word the same caveat differently, and a caveat that reads
// differently on two tabs of one page reads as two different problems. It is
// also where most of the visual noise lived: each copy wrapped its prose in a
// bordered, filled panel, so a tab with a clamped window AND an excluded
// account showed two boxes that looked like two warnings before the reader
// reached a single number.
//
// They are footnotes, not warnings, and FootNote renders them as such.
// ============================================================================
import type { ReactNode } from 'react';
import { EmptyState, SkeletonTable } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { FootNote } from '../../_shared/StatRail';
import { GoogleStateNotice } from './GoogleStateNotice';
import type { GoogleExcludedAccount, GoogleState } from '../api';
import SpendFreshnessNote, { type SpendFreshness } from '@/features/marketing/_shared/SpendFreshnessNote';

export function ExcludedAccountsNote({ accounts }: { accounts: GoogleExcludedAccount[] }) {
  if (accounts.length === 0) return null;
  return (
    <FootNote>
      {accounts.length === 1 ? 'One Google account is' : `${accounts.length} Google accounts are`}
      {' '}not shown here because Elevate does not yet report in{' '}
      {accounts.length === 1 ? 'its' : 'their'} currency:{' '}
      {accounts.map((a, i) => (
        <span key={a.customerId}>
          {i > 0 ? ', ' : ''}
          {a.name ?? a.customerId}
          {a.currency ? ` (${a.currency})` : ''}
        </span>
      ))}
      .
    </FootNote>
  );
}

export function GoogleTabFrame({
  state,
  isLoading,
  isError,
  errorLabel,
  windowClamped,
  freshness,
  effectiveSince,
  /** How far back this tab's own table actually reaches. 92 for the deep
   *  grains, 30 for search terms — stated rather than assumed, because the
   *  two genuinely differ and a reader who is told "92 days" while looking at
   *  30 has been misled by the page, not by the data. */
  windowDays = 92,
  excludedAccounts,
  children,
  footer,
}: {
  state: GoogleState | undefined;
  isLoading: boolean;
  isError: boolean;
  errorLabel: string;
  windowClamped?: boolean;
  freshness?: SpendFreshness | null;
  effectiveSince?: string;
  windowDays?: number;
  excludedAccounts?: GoogleExcludedAccount[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (isError) return <EmptyState message={errorLabel} />;
  if (isLoading && state === undefined) return <SkeletonTable rows={8} cols={8} />;
  if (state === undefined) return null;

  return (
    <div className="flex flex-col gap-4">
      <GoogleStateNotice state={state} />
      {state === 'ok' && children}
      {footer}
      <SpendFreshnessNote freshness={freshness} />
      {windowClamped && effectiveSince && (
        <FootNote>
          This detail is kept for {windowDays} days. The selected period reaches further back, so the
          figures above start at {formatDate(effectiveSince)}.
        </FootNote>
      )}
      <ExcludedAccountsNote accounts={excludedAccounts ?? []} />
    </div>
  );
}

/** The paging control at the foot of a cursor-paged tab. */
export function ShowMore({
  hasNext, isFetching, onClick, label,
}: { hasNext: boolean; isFetching: boolean; onClick: () => void; label: string }) {
  if (!hasNext) return null;
  return (
    <div className="flex justify-center pt-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isFetching}
        className="rounded-full border border-border px-4 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-brand-200 hover:bg-brand-50/50 hover:text-ink disabled:opacity-50"
      >
        {isFetching ? 'Loading…' : label}
      </button>
    </div>
  );
}
