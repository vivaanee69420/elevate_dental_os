'use client';
// The named people behind the counts.
//
// Every other screen in this section reports how many. This one says who, which
// is the only view that can be checked against reality — an owner who recognises
// a name in the wrong channel has found an attribution bug that no aggregate
// would ever show.
//
// Paged and filtered on the SERVER: a window can hold thousands of people, and
// a table of fifty needs fifty names, not all of them.
import { useState } from 'react';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingLeads } from '../hooks';
import { type Channel } from '../api';
import { MarketingLeadsTable } from './MarketingLeadsTable';

const SIZE = 50;
const CHANNEL_FILTERS: Array<{ value: Channel | null; label: string }> = [
  { value: null, label: 'All channels' },
  { value: 'meta_ads', label: 'Facebook' },
  { value: 'google_ads', label: 'Google' },
  { value: 'other', label: 'Other sources' },
];
const OUTCOME_FILTERS: Array<{ value: 'any' | 'true' | 'false'; label: string }> = [
  { value: 'any', label: 'Everyone' },
  { value: 'true', label: 'Became patients' },
  { value: 'false', label: 'Did not' },
];

function Pill({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-[13px] ${
        active ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-ink-muted hover:bg-bg'
      }`}
    >
      {children}
    </button>
  );
}

export default function LeadsScreen() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [converted, setConverted] = useState<'any' | 'true' | 'false'>('any');
  const { data, isLoading, isError, error } = useMarketingLeads({
    page, size: SIZE, channel, converted,
  });

  // Any filter change invalidates the current page number.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / SIZE));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leads"
        subtitle="Everyone who enquired in this period, where they came from, and whether they became a patient."
      />
      <ScopePeriodBar />

      <div className="flex flex-wrap gap-2">
        {CHANNEL_FILTERS.map((f) => (
          <Pill key={f.label} active={channel === f.value} onClick={() => reset(setChannel)(f.value)}>
            {f.label}
          </Pill>
        ))}
        <span className="mx-1 w-px bg-border" />
        {OUTCOME_FILTERS.map((f) => (
          <Pill key={f.value} active={converted === f.value} onClick={() => reset(setConverted)(f.value)}>
            {f.label}
          </Pill>
        ))}
      </div>

      {isError ? (
        <EmptyState message={`Couldn't load leads: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading && !data ? (
        <SkeletonTable rows={10} cols={6} />
      ) : total === 0 ? (
        <EmptyState message="Nobody enquired in this period under these filters." />
      ) : (
        <>
          <MarketingLeadsTable rows={data?.rows ?? []} />

          <div className="flex items-center justify-between text-[13px] text-ink-muted">
            <span>
              {((page - 1) * SIZE) + 1}
              –
              {Math.min(page * SIZE, total)}
              {' of '}
              {total.toLocaleString('en-GB')}
            </span>
            <span className="flex gap-2">
              <Pill active={false} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Pill>
              <Pill active={false} onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>Next</Pill>
            </span>
          </div>

          <p className="text-[13px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">New patient</span>
            {' '}
            means they had no appointment before this period began.
            {' '}
            <span className="font-medium text-ink">Existing patient</span>
            {' '}
            means they enquired again having already been to the practice — matched to a
            Dentally record by email or phone.
          </p>
        </>
      )}
    </div>
  );
}
