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
import DateRangeFilter, { lastMonthRange, type DateRange } from './DateRangeFilter';
import PracticeTabs from '@/features/practices/PracticeTabs';
import { Card, EmptyState, SkeletonKpiRow, SkeletonChart } from '@/components/ui';
import { DetailModal } from '@/features/marketing/_shared/DetailModal';
import type { BenchmarkRow } from '../api';

// THE DEFAULT WINDOW IS THE LAST COMPLETE MONTH, NOT THIS ONE.
//
// This page is a verdict — green means a cost line beats the UK standard — and
// a month that has not ended cannot be read against an annual ratio. Receipts
// accrue daily while payroll, rent and lab bills post late, so early in a month
// costs are a stub and the margin looks spectacular. Measured on live data:
//
//     Jul 2026   staff 8.5% of revenue   margin 31.0%
//     Aug 2026   staff 6.9%              margin 18.2%
//     Sep, 9 days in   staff 0.3%        margin 66.6%
//
// The page opened on "this month" and rendered that 66.6% as "+56.6 pts vs
// benchmark" in green — a false positive on the one screen whose whole job is
// to tell an owner whether they are doing well.
// Uses the filter's own helper — a second copy of this date maths here could
// disagree with the pill it is meant to match.

/** Does the selected window run into the month in progress? */
function touchesCurrentMonth(r: DateRange): boolean {
  if (!r.to) return true;
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return r.to.slice(0, 7) >= key;
}

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

// The buckets in monthly_financials that fill each benchmark category. Kept
// beside COA_MAPPING above rather than restated in prose, so the proof panel
// and the mapping table below it can never describe different things.
const BUCKETS_BY_KEY: Record<string, string[]> = {
  dentist: ['associates'],
  staff: ['staff'],
  lab: ['lab', 'materials'],
  other: ['overhead', 'other'],
  profit: [],
};

/** The working behind one benchmark line. */
function BenchmarkProof({
  row, revenue, periods, partial, onClose,
}: {
  row: BenchmarkRow | null;
  revenue: number;
  periods: number;
  partial: boolean;
  onClose: () => void;
}) {
  const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
  const isProfit = row?.key === 'profit';
  const buckets = row ? (BUCKETS_BY_KEY[row.key] ?? []) : [];

  return (
    <DetailModal
      open={!!row}
      title={row?.label ?? ''}
      subtitle={row
        ? (isProfit
            ? 'What is left after every cost line above.'
            : `What you spent on ${row.label.toLowerCase()}, against the UK dental standard.`)
        : undefined}
      onClose={onClose}
    >
      {row ? (
        <div className="text-[13px]">
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginBottom: 16 }}>
            <dt className="text-ink-muted">Source</dt>
            <dd>
              Your accounting ledger (monthly financials)
              {buckets.length ? ` · ${buckets.join(' + ')} bucket${buckets.length > 1 ? 's' : ''}` : ' · revenue less every cost bucket'}
            </dd>
            <dt className="text-ink-muted">Covers</dt>
            <dd>{periods} month{periods === 1 ? '' : 's'} of real actuals</dd>
          </dl>

          <table className="w-full">
            <tbody>
              <tr className="border-t border-border">
                <td className="py-2 pr-2">Revenue in this period</td>
                <td className="py-2 text-right tabular-nums">{money(revenue)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-2">{isProfit ? 'Profit' : 'Spent on this line'}</td>
                <td className="py-2 text-right tabular-nums">{money(row.actual)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-2 text-ink-muted">As a share of revenue</td>
                <td className="py-2 text-right tabular-nums text-ink-muted">{row.actualPct.toFixed(1)}%</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 pr-2 text-ink-muted">
                  UK standard ({row.benchmarkPct}% of revenue)
                </td>
                <td className="py-2 text-right tabular-nums text-ink-muted">{money(row.benchmark)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td className="py-2.5 pr-2 font-semibold">
                  {isProfit
                    ? (row.variancePts >= 0 ? 'Above the 10% floor by' : 'Below the 10% floor by')
                    : (row.variancePts <= 0 ? 'Leaner than standard by' : 'Over standard by')}
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums">
                  {Math.abs(row.variancePts).toFixed(1)} pts · {money(Math.abs(row.actual - row.benchmark))}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="text-ink-muted mt-4 text-[12px] leading-relaxed">
            {partial
              ? 'This period includes the month in progress. Payroll, rent and lab bills post late, so the cost lines are understated and the margin overstated — which is why nothing here is graded.'
              : isProfit
                ? 'The benchmark is a floor, not a target: 10% is what a UK dental group is expected to clear, and every point a cost line comes down adds directly here.'
                : 'The benchmark is a share of revenue, so this line moves when either the spend or the revenue changes. A percentage falling because revenue rose is not the same as costs coming down.'}
          </p>
        </div>
      ) : null}
    </DetailModal>
  );
}

export default function ProfitBenchmarkScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [source, setSource] = useState<FinanceSource>('combined');
  const [qboAccountId, setQboAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(lastMonthRange());
  // A part-month's cost ratios are not comparable to an annual benchmark, so
  // the verdict COLOUR is withheld rather than shown wrong. The figures stay —
  // they are real, they are simply not a verdict yet.
  const partial = touchesCurrentMonth(range);
  // Which card's working is open. Every figure here comes from monthly_financials
  // — verified against the ledger: Aug 2026 revenue £373,019.35, associates
  // £98,651.96 (26.4%), staff £25,782.81 (6.9%), lab £63,011.18 + materials
  // £12,749.14 (20.3%), overhead £105,010.27 (28.2%) — so the panel can show the
  // buckets that add up to each line rather than assert a percentage.
  const [proofKey, setProofKey] = useState<string | null>(null);
  const toneOf = (severity: string) => (partial ? 'neutral' : severity);
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

      {/* Say why the verdict colours are missing, rather than let a page whose
          whole point is a judgement quietly stop judging. */}
      {partial ? (
        <div className="card-padded" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">This month is not finished, so nothing is graded</div>
          <div className="text-sm text-ink-muted">
            Payments arrive daily but payroll, rent and lab bills post late, so part way through a
            month your costs look far lower than they will be — and the margin far higher. The
            figures below are real; they are just not comparable to an annual benchmark yet. Pick a
            completed month to see how you actually did.
          </div>
        </div>
      ) : null}

      {/* Filters grouped in one block so the parent's flex gap spaces the whole
          group once (not once per bar) — keeps spacing tight + matching the P&L. */}
      <div>
        <ProfitSourceBar
          source={source}
          onSourceChange={setSource}
          accountId={qboAccountId}
          onAccountChange={setQboAccountId}
          disabledSources={{
            dentally: 'Dentally records what patients paid, never what anything cost — so it cannot produce cost ratios. Use QuickBooks or Combined.',
          }}
        />
        {/* QuickBooks is scoped by company, not practice — hide the practice tabs. */}
        {source !== 'quickbooks' && <PracticeTabs dentallyOnly value={practiceId} onChange={setPracticeId} />}
        {/* Period filter — windows the benchmark to a month/year/custom range
            (defaults to the current month). */}
        <DateRangeFilter value={range} onChange={setRange} initialMode="last-month" />
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
        <Card>
        <EmptyState
          message={
            source === 'dentally'
              ? 'Dentally provides no cost data, so a cost/profit benchmark can’t be built from it. Switch the data source to QuickBooks or Combined.'
              : source === 'quickbooks'
                ? 'No QuickBooks cost data for this scope yet. Connect and sync a QuickBooks company and the benchmark derives from its real actuals — we never estimate cost ratios.'
                : 'No filed cost data for this scope yet. Connect Xero/QuickBooks (or enter a monthly P&L) and the benchmark derives from your real actuals — we never estimate cost ratios.'
          }
        />
        </Card>
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
              <button
                key={r.key}
                type="button"
                onClick={() => setProofKey(r.key)}
                className="card-padded text-left transition-colors hover:border-brand-200"
              >
                <div className="text-xs text-ink-muted uppercase">{r.label}</div>
                <div className="display text-2xl font-bold mt-1">{gbp(r.actual)}</div>
                <div className="text-xs text-ink-muted mt-1">
                  {r.actualPct.toFixed(1)}% of revenue · benchmark {r.benchmarkPct}%
                </div>
                <div className="mt-2">
                  <Pill severity={toneOf(r.severity)}>
                    {signed(r.variancePts)} pts vs benchmark
                  </Pill>
                  <div className="text-[11px] text-brand mt-2">Show working</div>
                </div>
              </button>
            ))}
          </div>

          {/* The working behind whichever card was clicked. Every line here is
              read from monthly_financials — the same ledger the P&L and the
              cashflow page use — so the three cannot disagree. */}
          <BenchmarkProof
            row={data.rows.find((x) => x.key === proofKey) ?? null}
            revenue={data.revenue}
            periods={data.periodsCovered}
            partial={partial}
            onClose={() => setProofKey(null)}
          />

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
                        style={{ color: TONE[toneOf(r.severity)]?.fg ?? TONE.neutral.fg }}
                      >
                        {signed(r.variancePts)}
                      </td>
                      <td className="p-3">
                        <Pill severity={toneOf(r.severity)}>{r.verdict}</Pill>
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
