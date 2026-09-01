'use client';
// Every practice side by side.
//
// The rest of the section shows one practice at a time, which answers "how is
// Barnet doing" but never "which site is the money working hardest at". This is
// that comparison, and it is only possible because ad spend now carries the
// practice its account is mapped to (migration 000140) — before that, every
// per-practice spend figure in the product was £0.
//
// A person who enquired at two practices is counted at the earlier one, so
// these rows sum to the group total rather than double-counting them.
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { usePractices } from '@/features/practices/hooks';
import { useMarketingPerformance } from '../hooks';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type Channel, type PracticeRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const num = (n: number) => n.toLocaleString('en-GB');
const CHANNELS: Channel[] = ['meta_ads', 'google_ads', 'other'];

// Channel mix as one bar per practice. Length is share, not absolute volume —
// the lead count sits beside it, so the bar is answering "what mix" rather than
// competing with the number for "how many".
function ChannelMix({ row }: { row: PracticeRow }) {
  const total = CHANNELS.reduce((n, c) => n + (row.channels[c] ?? 0), 0);
  if (total === 0) return <span className="text-ink-muted">—</span>;
  return (
    <div className="flex h-2 w-full min-w-[120px] gap-[2px] overflow-hidden rounded-[4px]">
      {CHANNELS.map((c) => {
        const v = row.channels[c] ?? 0;
        if (v === 0) return null;
        return (
          <span
            key={c}
            className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ width: `${(v / total) * 100}%`, background: CHANNEL_COLOUR[c] }}
            title={`${CHANNEL_LABEL[c]}: ${num(v)}`}
          />
        );
      })}
    </div>
  );
}

export default function PracticesScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const { data: practiceData } = usePractices();
  const nameOf = (id: string | null) => (id === null
    ? 'Not assigned to a practice'
    : practiceData?.practices?.find((p) => p.id === id)?.name ?? 'Unknown practice');

  const rows = data?.byPractice ?? [];
  const totals = rows.reduce((a, r) => ({
    spendPence: a.spendPence + r.spendPence,
    leads: a.leads + r.leads,
    patients: a.patients + r.patients,
    newPatients: a.newPatients + r.newPatients,
  }), { spendPence: 0, leads: 0, patients: 0, newPatients: 0 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Practices"
        subtitle="Every practice side by side — what each spent, what it brought in, and what a new patient cost."
      />
      <ScopePeriodBar />

      {isError ? (
        <EmptyState message={`Couldn't load practices: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : rows.length === 0 ? (
        <EmptyState message="No advertising spend or leads in this window." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-panel border border-border bg-surface">
            <table className="w-full text-[13.5px]">
              <thead className="bg-bg">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Practice</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">Spend</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">Leads</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel mix</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per lead</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">New patients</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">Existing</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per new patient</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.practiceId ?? 'none'} className="border-t border-border hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-ink">{nameOf(r.practiceId)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.spendPence > 0 ? money(r.spendPence) : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.leads)}</td>
                    <td className="px-4 py-3"><ChannelMix row={r} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerLeadPence)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.newPatients)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                      {num(r.patients - r.newPatients)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerNewPatientPence)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-bg font-medium">
                  <td className="px-4 py-3 text-ink">Group</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(totals.spendPence)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(totals.leads)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totals.leads > 0 && totals.spendPence > 0
                      ? money(Math.round(totals.spendPence / totals.leads)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(totals.newPatients)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {num(totals.patients - totals.newPatients)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totals.newPatients > 0 && totals.spendPence > 0
                      ? money(Math.round(totals.spendPence / totals.newPatients)) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-ink-muted">
            <span className="font-medium text-ink">Channel mix:</span>
            {CHANNELS.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CHANNEL_COLOUR[c] }} />
                {CHANNEL_LABEL[c]}
              </span>
            ))}
          </div>

          <p className="text-[13px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">New patients</span>
            {' '}
            had no appointment before this period began. Existing patients enquired again
            having already been to the practice — real enquiries, but not something the
            advertising won, so cost per new patient is measured against the new ones only.
            A practice with no mapped advertising account shows no spend and no cost, never
            £0.00.
          </p>
        </>
      )}
    </div>
  );
}
