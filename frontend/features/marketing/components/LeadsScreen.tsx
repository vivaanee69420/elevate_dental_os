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
import { PageHeader, EmptyState, SkeletonTable, StatusBadge } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { usePractices } from '@/features/practices/hooks';
import { useMarketingLeads } from '../hooks';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type Channel } from '../api';

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

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function LeadsScreen() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [converted, setConverted] = useState<'any' | 'true' | 'false'>('any');
  const { data, isLoading, isError, error } = useMarketingLeads({
    page, size: SIZE, channel, converted,
  });
  const { data: practiceData } = usePractices();
  const practiceName = (id: string | null) => (id
    ? practiceData?.practices?.find((p) => p.id === id)?.name ?? '—'
    : '—');

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
          <div className="overflow-x-auto rounded-panel border border-border bg-surface">
            <table className="w-full text-[13.5px]">
              <thead className="bg-bg">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Enquired</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Practice</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r) => (
                  <tr key={r.contactId} className="border-t border-border hover:bg-bg">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{r.name ?? 'Name not recorded'}</div>
                      {r.email || r.phone ? (
                        <div className="mt-0.5 text-[12.5px] text-ink-muted">
                          {r.email ?? r.phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{formatWhen(r.enquiredAt)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: CHANNEL_COLOUR[r.channel] }}
                        />
                        {CHANNEL_LABEL[r.channel] ?? r.channel}
                      </span>
                      {r.attributionSource ? (
                        <div className="mt-0.5 text-[12.5px] text-ink-muted">{r.attributionSource}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.campaignName ?? (r.campaignId ? r.campaignId : '—')}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{practiceName(r.practiceId)}</td>
                    <td className="px-4 py-3">
                      {r.isNewPatient ? (
                        <StatusBadge tone="success">New patient</StatusBadge>
                      ) : r.converted ? (
                        <span className="text-ink-muted">Existing patient</span>
                      ) : (
                        <span className="text-ink-muted">Enquiry only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
