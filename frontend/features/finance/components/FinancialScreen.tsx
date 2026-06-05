'use client';
// Financial Statements — real-data wired. Margins are REAL (baseline P&L).
// The balance sheet has NO accounting source: every line is ESTIMATED from
// the baseline + owner-editable assumptions (DSO / payable days), each field
// flagged estimated and bannered — never presented as filed accounts. The
// fabricated director-loan ledger was removed (no real source). Assumptions
// persist in the URL (?dsoDays=&payableDays=) so the page is bookmarkable
// (brief 06 hard rule).

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { annualTotal } from '../mock';
import { useFinancial, useFinanceSeries } from '../hooks';
import FinanceToolbar from './FinanceToolbar';
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange } from './DateRangeFilter';

function fmt(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}
const LIGHT: Record<string, string> = {
  green: 'var(--success)',
  amber: 'var(--warning)',
  red: 'var(--danger)',
};
const RATIO_LABEL: Record<string, string> = {
  grossMarginPct: 'Gross margin',
  netMarginPct: 'Net margin',
  currentRatio: 'Current ratio',
  quickRatio: 'Quick ratio',
  debtToEquity: 'Debt to equity',
  daysSalesOutstanding: 'Days sales outstanding',
};

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && (
        <div className="text-xs font-semibold mt-1" style={{ color: 'var(--success)' }}>
          {delta}
        </div>
      )}
    </div>
  );
}

function Est() {
  return (
    <span
      className="chip chip-amber"
      style={{ fontSize: 10, marginLeft: 6 }}
      title="Estimated — derived from your baseline + assumptions, not filed accounts"
    >
      Est.
    </span>
  );
}

export default function FinancialScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const dsoDays = Math.max(0, parseInt(params.get('dsoDays') ?? '45', 10) || 45);
  const payableDays = Math.max(
    0,
    parseInt(params.get('payableDays') ?? '30', 10) || 30,
  );

  function setParam(k: string, v: number) {
    const next = new URLSearchParams(Array.from(params.entries()));
    next.set(k, String(v));
    router.replace(`?${next.toString()}`);
  }

  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const { data, isLoading, isError } = useFinancial(dsoDays, payableDays, practiceId, range);
  const { data: seriesData } = useFinanceSeries(practiceId, range);
  const noBaseline = !!data?.error;
  const ratios = data?.ratios ?? [];
  const bs = data?.balanceSheet ?? {};
  const series = seriesData?.months ?? [];
  const annual =
    series.length > 0
      ? annualTotal(series)
      : { revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0, profit: 0 };

  const cell = (k: string) => bs[k]?.value ?? 0;
  const isEst = (k: string) => bs[k]?.estimated ?? true;

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Financial Statements</h1>
        <p className="text-sm text-ink-muted">
          Key ratios · Balance sheet · Annual summary
        </p>
        <FinanceToolbar />
      </div>

      <PracticeTabs value={practiceId} onChange={setPracticeId} />
      <DateRangeFilter value={range} onChange={setRange} />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load financials</div>
          <div className="text-sm text-ink-muted">Refresh to retry.</div>
        </div>
      )}
      {noBaseline && !isError && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">
            {practiceId ? 'No P&L actuals for this practice' : 'No baseline set'}
          </div>
          <div className="text-sm text-ink-muted">
            {practiceId
              ? 'Per-practice financials show real actuals only (the group baseline is not split per practice). Enter P&L actuals for this practice on the Profit screen, or connect Xero with practice tagging.'
              : 'Financials read from your Business Health baseline. Complete setup to populate them.'}
          </div>
        </div>
      )}
      {!noBaseline && !isError && !data?.costsAvailable && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">Revenue is real · costs &amp; balance sheet are £0</div>
          <div className="text-sm text-ink-muted">
            Revenue is real (settled payments). We have no cost or accounting
            data — Dentally doesn&rsquo;t provide it — so margins, the balance
            sheet (except real bank cash) and ratios are £0, not estimated.
            Connect Xero / open banking for the rest.
          </div>
        </div>
      )}

      {/* Owner-editable assumptions (persisted in URL) */}
      <div
        className="bg-bg flex gap-6 items-center flex-wrap mb-4"
        style={{ borderRadius: 10, padding: 12 }}
      >
        <div className="text-xs text-ink-muted uppercase font-bold">
          Your assumptions
        </div>
        <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
          Debtor days (DSO)
          <input
            type="number"
            min={0}
            max={365}
            defaultValue={dsoDays}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 0 && n <= 365) setParam('dsoDays', n);
            }}
            style={{
              width: 64,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 5,
            }}
          />
        </label>
        <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
          Payable days
          <input
            type="number"
            min={0}
            max={365}
            defaultValue={payableDays}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 0 && n <= 365) setParam('payableDays', n);
            }}
            style={{
              width: 64,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 5,
            }}
          />
        </label>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          label="Revenue (TTM)"
          value={isLoading ? '…' : fmt(annual.revenue)}
          delta="Real · settled payments"
        />
        <Kpi
          label="Total assets (est.)"
          value={isLoading ? '…' : fmt(cell('currentAssetsPence'))}
        />
        <Kpi
          label="Equity (est.)"
          value={isLoading ? '…' : fmt(cell('equityPence'))}
          delta="Assets − liabilities"
        />
        <Kpi
          label="Net margin"
          value={
            isLoading
              ? '…'
              : `${ratios.find((r) => r.key === 'netMarginPct')?.value ?? 0}%`
          }
          delta={data?.costsAvailable ? 'Real (P&L actuals)' : 'No cost data (£0)'}
        />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Key ratios */}
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">Key ratios</h2>
          {isLoading ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              Loading…
            </div>
          ) : ratios.length === 0 ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              No data — set your baseline.
            </div>
          ) : (
            ratios.map((r) => (
              <div
                key={r.key}
                className="flex justify-between items-center"
                style={{ padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}
              >
                <span className="text-ink-muted">
                  {RATIO_LABEL[r.key] ?? r.key}
                  {r.estimated && <Est />}
                </span>
                <span className="font-semibold" style={{ color: LIGHT[r.light] ?? 'inherit' }}>
                  {r.key.endsWith('Pct') ? `${r.value}%` : r.value}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Balance sheet */}
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">Balance sheet (estimated)</h2>
          {isLoading ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              Loading…
            </div>
          ) : Object.keys(bs).length === 0 ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              No data — set your baseline.
            </div>
          ) : (
            <div style={{ fontSize: 13 }}>
              {[
                ['cashPence', 'Cash at bank'],
                ['receivablesPence', 'Trade debtors'],
                ['currentAssetsPence', 'Total assets'],
                ['payablesPence', 'Trade creditors'],
                ['currentLiabilitiesPence', 'Total liabilities'],
                ['equityPence', 'Equity (net assets)'],
              ].map(([k, label]) => (
                <div
                  key={k}
                  className="flex justify-between items-center"
                  style={{ padding: '6px 0' }}
                >
                  <span className="text-ink-muted">
                    {label}
                    {isEst(k) && <Est />}
                  </span>
                  <span className="font-semibold">{fmt(cell(k))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Annual P&L summary (baseline projection) */}
      {series.length > 0 && (
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">
            Annual P&amp;L summary
            <span className="text-xs text-ink-muted font-normal" style={{ marginLeft: 8 }}>
              · revenue real (settled payments){seriesData && !seriesData.costsAvailable ? ' · costs £0 (no cost source)' : ''}
            </span>
          </h2>
          <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Line</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Annual</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>% of revenue</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Revenue', annual.revenue],
                ['Associate pay', annual.associate_pay],
                ['Staff costs', annual.staff_costs],
                ['Lab + materials', annual.lab_materials],
                ['OpEx', annual.opex],
                ['Net profit', annual.profit],
              ].map(([label, amount]) => (
                <tr key={label as string} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px' }}>{label}</td>
                  <td className="text-right" style={{ padding: '10px 8px' }}>
                    {fmt(amount as number)}
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px' }}>
                    {label === 'Revenue'
                      ? '100%'
                      : annual.revenue > 0
                        ? `${(((amount as number) / annual.revenue) * 100).toFixed(1)}%`
                        : '0%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
