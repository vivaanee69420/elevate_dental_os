'use client';
// Profit Benchmarking (Intelligence OS — CoA→P&L). Your actual cost/profit
// ratios vs the UK dental group benchmarks (Dentist 45 · Staff 18 · Lab+Material
// 15 · Other Fixed 12 · Profit 10). Backed by GET /api/analytics/pl-benchmark —
// real monthly_financials actuals only; no cost source ⇒ empty state, never an
// estimate (FORMULAS §1b). The CoA→P&L mapping panel shows the real bucket →
// benchmark-category mapping that drives the statement (account-code-level Xero
// mapping is a separate owner-gated slice). Per-practice tab.

import { useState } from 'react';
import { useProfitBenchmark } from '../hooks';
import type { FinanceSource } from '../api';
import ProfitSourceBar from './ProfitSourceBar';
import DateRangeFilter, { type DateRange } from './DateRangeFilter';
import PracticeTabs from '@/features/practices/PracticeTabs';
import { Card, EmptyState, SkeletonKpiRow, SkeletonChart } from '@/components/ui';

const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);

const TONE: Record<string, { fg: string; bg: string }> = {
  good: { fg: 'var(--success)', bg: 'var(--success-50, #DCFCE7)' },
  bad: { fg: 'var(--danger)', bg: '#FEE2E2' },
  neutral: { fg: 'var(--ink-muted)', bg: 'var(--bg)' },
};

// The real bucket → benchmark-category mapping the compute uses (FORMULAS §1b).
// This is the CoA→P&L mapping: monthly_financials dental_bucket lines (filled by
// the Xero / QuickBooks sync or manual entry) rolled into the five benchmark
// categories. Reference, not org data — honest about what feeds each line.
const COA_MAPPING: { category: string; bm: number; buckets: string }[] = [
  { category: 'Dentist / associate', bm: 45, buckets: 'associates' },
  { category: 'Support staff', bm: 18, buckets: 'staff' },
  { category: 'Lab + material', bm: 15, buckets: 'lab + materials' },
  { category: 'Other fixed costs', bm: 12, buckets: 'overhead (property · marketing) + other' },
  { category: 'Profit', bm: 10, buckets: 'revenue − all cost buckets' },
];

function Pill({ severity, children }: { severity: string; children: React.ReactNode }) {
  const t = TONE[severity] ?? TONE.neutral;
  return (
    <span
      className="text-xs font-semibold rounded px-2 py-0.5"
      style={{ background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}
    >
      {children}
    </span>
  );
}

export default function ProfitBenchmarkScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [source, setSource] = useState<FinanceSource>('combined');
  const [qboAccountId, setQboAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const { data, isLoading, isError } = useProfitBenchmark(practiceId, source, qboAccountId, range);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="display text-xl font-bold">Profit Benchmarking — you vs the industry standard</h2>
        <p className="text-sm text-ink-muted mt-1">
          Your actual cost and profit ratios against the UK dental benchmark. Green means a cost line is
          leaner than standard, or profit beats the 10% floor; red is the opposite. This is where the
          margin is won or lost.
        </p>
      </div>

      {/* Filters grouped in one block so the parent's flex gap spaces the whole
          group once (not once per bar) — keeps spacing tight + matching the P&L. */}
      <div>
        <ProfitSourceBar
          source={source}
          onSourceChange={setSource}
          accountId={qboAccountId}
          onAccountChange={setQboAccountId}
        />
        {/* QuickBooks is scoped by company, not practice — hide the practice tabs. */}
        {source !== 'quickbooks' && <PracticeTabs dentallyOnly value={practiceId} onChange={setPracticeId} />}
        {/* Period filter — windows the benchmark to a month/year/custom range;
            Recent (default) keeps the trailing-12mo actuals. */}
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {isLoading && (
        <>
          <SkeletonKpiRow count={3} />
          <SkeletonChart height={260} />
        </>
      )}

      {isError && (
        <Card>
          <div className="text-sm text-danger">Couldn&apos;t load the benchmark. Retry shortly.</div>
        </Card>
      )}

      {!isLoading && !isError && data && !data.costsAvailable && (
        <EmptyState
          message={
            source === 'dentally'
              ? 'Dentally provides no cost data, so a cost/profit benchmark can’t be built from it. Switch the data source to QuickBooks or Combined.'
              : source === 'quickbooks'
                ? 'No QuickBooks cost data for this scope yet. Connect and sync a QuickBooks company and the benchmark derives from its real actuals — we never estimate cost ratios.'
                : 'No filed cost data for this scope yet. Connect Xero/QuickBooks (or enter a monthly P&L) and the benchmark derives from your real actuals — we never estimate cost ratios.'
          }
        />
      )}

      {!isLoading && !isError && data && data.costsAvailable && (
        <>
          {/* Honest flag: Xero folds associate pay into staff (no associates bucket) */}
          {!data.dentistStaffSeparable && (
            <div
              className="text-sm rounded-lg p-3"
              style={{ background: '#FEF3C7', color: '#78350F' }}
            >
              <b>Dentist &amp; staff are combined.</b> Your accounting sync books associate pay inside
              support-staff wages, so the Dentist line reads £0 and Staff is inflated. Map a separate
              associate / locum account in Xero to split the two against their 45% / 18% benchmarks.
            </div>
          )}

          {/* Five cost-line tiles */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {data.rows.map((r) => (
              <div key={r.key} className="card-padded">
                <div className="text-xs text-ink-muted uppercase">{r.label}</div>
                <div className="display text-2xl font-bold mt-1">{gbp(r.actual)}</div>
                <div className="text-xs text-ink-muted mt-1">
                  {r.actualPct.toFixed(1)}% of revenue · benchmark {r.benchmarkPct}%
                </div>
                <div className="mt-2">
                  <Pill severity={r.severity}>
                    {signed(r.variancePts)} pts vs benchmark
                  </Pill>
                </div>
              </div>
            ))}
          </div>

          {/* Variance table */}
          <Card padded={false}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Benchmark detail</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Trailing {data.periodsCovered} month{data.periodsCovered === 1 ? '' : 's'} of real
                  actuals · group margin {data.marginPct.toFixed(1)}%
                </p>
              </div>
              {data.overspend > 0 && (
                <span className="text-xs text-ink-muted">
                  Recoverable to benchmark: <b style={{ color: 'var(--danger)' }}>{gbp(data.overspend)}</b>
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <thead className="bg-bg border-b border-border">
                  <tr>
                    <th className="text-left p-3 font-semibold">Category</th>
                    <th className="text-right p-3 font-semibold">Benchmark £</th>
                    <th className="text-right p-3 font-semibold">Benchmark %</th>
                    <th className="text-right p-3 font-semibold">Actual £</th>
                    <th className="text-right p-3 font-semibold">Actual %</th>
                    <th className="text-right p-3 font-semibold">Variance</th>
                    <th className="text-left p-3 font-semibold">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.key} className="border-b border-border">
                      <td className="p-3">{r.label}</td>
                      <td className="p-3 text-right">{gbp(r.benchmark)}</td>
                      <td className="p-3 text-right">{r.benchmarkPct}%</td>
                      <td className="p-3 text-right">{gbp(r.actual)}</td>
                      <td className="p-3 text-right">{r.actualPct.toFixed(1)}%</td>
                      <td
                        className="p-3 text-right font-semibold"
                        style={{ color: TONE[r.severity]?.fg ?? TONE.neutral.fg }}
                      >
                        {signed(r.variancePts)}
                      </td>
                      <td className="p-3">
                        <Pill severity={r.severity}>{r.verdict}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 text-xs text-ink-muted border-t border-border">
              Benchmarks: Dentist 45% · Staff 18% · Lab + Material 15% · Other Fixed 12% · Profit 10%.
              Move any overspending line one point toward benchmark and it drops straight to the bottom line.
            </div>
          </Card>

          {/* Chart of accounts → P&L mapping (real bucket → category logic) */}
          <Card padded={false}>
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold">Chart of accounts → P&amp;L mapping</h3>
              <p className="text-xs text-ink-muted mt-0.5">
                How the accounting ledger is categorised into this statement. Each P&amp;L bucket is filled
                by the Xero / QuickBooks sync (or manual entry) and rolled into a benchmark category — so
                the P&amp;L, benchmark and cashflow all reconcile to the same ledger.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 520 }}>
                <thead className="bg-bg border-b border-border">
                  <tr>
                    <th className="text-left p-3 font-semibold">Benchmark category</th>
                    <th className="text-right p-3 font-semibold">Benchmark %</th>
                    <th className="text-left p-3 font-semibold">P&amp;L buckets (monthly_financials)</th>
                  </tr>
                </thead>
                <tbody>
                  {COA_MAPPING.map((m) => (
                    <tr key={m.category} className="border-b border-border">
                      <td className="p-3">{m.category}</td>
                      <td className="p-3 text-right">{m.bm}%</td>
                      <td className="p-3 text-ink-muted">{m.buckets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 text-xs text-ink-muted border-t border-border">
              Account-code-level mapping (which Xero account feeds each bucket) is managed at the Xero
              sync. Unmapped or mis-coded accounts are the usual reason a dental P&amp;L looks wrong.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
