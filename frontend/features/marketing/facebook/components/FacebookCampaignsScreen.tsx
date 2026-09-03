'use client';
// Facebook report — campaign tier. The first screen of two sub-projects of
// work (the deep-grain ad_meta_funnel plumbing, and this report), so it
// follows the sibling Campaigns screen's table idiom rather than inventing
// a new one.
//
// Four states rather than one generic empty table — see FacebookStateNotice.
// For 'not_connected'/'never_synced' the notice replaces the table entirely.
// For 'no_ad_id_coverage' the table STILL renders: spend/impressions/clicks
// are real, only the funnel is unavailable below campaign level.
import Link from 'next/link';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatPence, formatDate } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useFacebookCampaigns } from '../hooks';
import { FacebookStateNotice } from './FacebookStateNotice';
import type { FacebookRow, FacebookFunnelTotals } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
// null when there were no impressions to divide by — a rate over nothing is
// unknowable, not zero.
const ctrPct = (ctr: number | null) => (ctr === null ? '—' : `${(ctr * 100).toFixed(2)}%`);
const num = (n: number) => n.toLocaleString('en-GB');

const TH = 'px-4 py-3 text-right font-medium text-ink-muted';
const TD = 'px-4 py-3 text-right tabular-nums';

// Calm, factual prose — never an error/warning colour. Matches
// AdReconciliationPanel's info Note: these are facts about the data, not
// problems with it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

function Row({ row, isTotals = false }: { row: FacebookRow; isTotals?: boolean }) {
  return (
    <tr className={`border-t border-border ${isTotals ? 'bg-bg font-medium' : 'hover:bg-bg'}`}>
      <td className="px-4 py-3">
        {isTotals || !row.id ? (
          <span className="text-ink">Total</span>
        ) : (
          <Link
            href={`/marketing-facebook/${encodeURIComponent(row.id)}`}
            className="font-medium text-brand hover:underline"
          >
            {row.name ?? row.id}
          </Link>
        )}
      </td>
      <td className={TD}>{money(row.spendPence)}</td>
      <td className={TD}>{num(row.impressions)}</td>
      <td className={TD}>{num(row.clicks)}</td>
      <td className={TD}>{ctrPct(row.ctr)}</td>
      <td className={TD}>{money(row.cpcPence)}</td>
      <td className={TD}>{num(row.leads)}</td>
      <td className={TD}>{num(row.booked)}</td>
      <td className={TD}>{num(row.attended)}</td>
      <td className={TD}>{num(row.patients)}</td>
      <td className={TD}>{money(row.cplPence)}</td>
      <td className={TD}>{money(row.cpbPence)}</td>
      <td className={TD}>{money(row.cpaPence)}</td>
    </tr>
  );
}

function unmatchedLeadsNote(funnel: FacebookFunnelTotals) {
  const noun = funnel.leads === 1 ? 'lead belongs' : 'leads belong';
  const pronoun = funnel.leads === 1 ? 'it is' : 'they are';
  return (
    <Note>
      {num(funnel.leads)} more Meta {noun} to a campaign with no spend recorded in this
      window, so {pronoun} not included in the table above.
    </Note>
  );
}

export default function FacebookCampaignsScreen() {
  const { data, isLoading, isError, error } = useFacebookCampaigns();
  const rows = data?.rows ?? [];
  // Platform metrics stand on their own even without ad-id coverage; only
  // 'not_connected'/'never_synced' have literally nothing to show.
  const showTable = data && (data.state === 'ok' || data.state === 'no_ad_id_coverage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Facebook"
        subtitle="Meta campaign performance, from spend down to the patient it produced. Attendance is recorded in Dentally only."
      />
      <ScopePeriodBar />

      {isError ? (
        <EmptyState message={`Couldn't load the Facebook report: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading && !data ? (
        <SkeletonTable rows={8} cols={13} />
      ) : data ? (
        <>
          <FacebookStateNotice state={data.state} coverage={data.coverage} />

          {data.windowClamped && (
            <Note>
              Ad set and ad detail is kept for 92 days. This period reaches further back
              than that, so figures below are shown from {formatDate(data.effectiveSince)}
              {' '}onward rather than the whole period.
            </Note>
          )}

          {showTable && (
            rows.length === 0 ? (
              <EmptyState message="No Facebook campaign spend in this window." />
            ) : (
              <DeferUntilVisible minHeight={360}>
                <div className="overflow-x-auto rounded-panel border border-border bg-surface">
                  <table className="w-full text-[13.5px]">
                    <thead className="bg-bg">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
                        <th className={TH}>Spend</th>
                        <th className={TH}>Impressions</th>
                        <th className={TH}>Clicks</th>
                        <th className={TH}>CTR</th>
                        <th className={TH}>CPC</th>
                        <th className={TH}>Leads</th>
                        <th className={TH}>Booked</th>
                        <th
                          className={TH}
                          title="Dentally-only: a GoHighLevel booking cannot say whether someone turned up."
                        >
                          Attended*
                        </th>
                        <th className={TH}>Patients</th>
                        <th className={TH}>CPL</th>
                        <th className={TH}>CPB</th>
                        <th className={TH}>CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => <Row key={r.id ?? `row-${i}`} row={r} />)}
                      {data.totals && <Row row={data.totals} isTotals />}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[12px] text-ink-muted">
                  * Attended is Dentally-only — a GoHighLevel booking alone cannot say
                  whether someone turned up.
                </p>
              </DeferUntilVisible>
            )
          )}

          {data.unmatchedLeads && unmatchedLeadsNote(data.unmatchedLeads)}

          {data.excludedAccounts.length > 0 && (
            <Note>
              {data.excludedAccounts.length === 1
                ? 'One Meta account is'
                : `${data.excludedAccounts.length} Meta accounts are`}
              {' '}not shown here because Elevate does not yet report in{' '}
              {data.excludedAccounts.length === 1 ? 'its' : 'their'} currency:{' '}
              {data.excludedAccounts.map((a, i) => (
                <span key={a.customerId}>
                  {i > 0 ? ', ' : ''}
                  {a.name ?? a.customerId}
                  {a.currency ? ` (${a.currency})` : ''}
                </span>
              ))}
              .
            </Note>
          )}
        </>
      ) : null}
    </div>
  );
}
