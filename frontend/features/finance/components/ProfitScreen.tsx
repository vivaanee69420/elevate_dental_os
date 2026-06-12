'use client';
// Profit & Loss — real-data wired. 12-month consolidated P&L from
// GET /api/analytics/finance-series (baseline projection — derived, NOT
// filed accounts). KPI strip, revenue vs profit chart, monthly breakdown +
// FY total. Export PDF uses the same on-screen styling (brief 06 hard rule)
// via the print-window pattern. annualTotal/formatters stay pure helpers.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useState } from 'react';
import { Skeleton } from '@/components/ui';
import { annualTotal, poundsCompact, monthLabel, monthShort } from '../mock';
import { useFinanceSeries } from '../hooks';
import type { FinanceSource } from '../api';
import FinanceToolbar from './FinanceToolbar';
import ManualPLModal from './ManualPLModal';
import ProfitSourceBar from './ProfitSourceBar';
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange } from './DateRangeFilter';

const BASIS_LABEL: Record<string, string> = {
  actuals: 'real actuals (Xero / manual entry)',
  mixed: 'real costs where entered, £0 elsewhere (no cost source)',
  'revenue-only': 'real revenue (settled payments) · costs/profit £0 until Xero',
};

const BRAND = 'var(--brand)';
const ACCENT = 'var(--accent)';

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

export default function ProfitScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [source, setSource] = useState<FinanceSource>('combined');
  const [qboAccountId, setQboAccountId] = useState<string | null>(null);
  const rangeActive = !!(range.from && range.to);
  // Two series. The filtered window drives the chart + monthly breakdown. The
  // fixed last-12-months series drives the KPI cards, so "Annual revenue",
  // "Avg monthly revenue" and "This month" do NOT shift when a date filter is
  // applied — they always reflect the rolling year / current month.
  const { data, isLoading, isError } = useFinanceSeries(practiceId, range, source, qboAccountId);
  const { data: annualData, isLoading: annualLoading } = useFinanceSeries(practiceId, null, source, qboAccountId);
  const [plModalOpen, setPlModalOpen] = useState(false);
  // Per-source provenance line under the title. QuickBooks/Dentally override the
  // generic basis copy so it's clear which feed the P&L is being built from.
  const SOURCE_NOTE: Record<FinanceSource, string> = {
    combined: BASIS_LABEL[data?.basis ?? 'revenue-only'] ?? BASIS_LABEL['revenue-only'],
    dentally: 'Dentally — real settled/billed revenue · no cost data, profit £0',
    quickbooks: 'QuickBooks — real P&L (revenue + costs) from connected companies',
  };
  const basisLabel = SOURCE_NOTE[source];

  const ZERO = { revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0, profit: 0 };

  // Filtered window — chart + monthly breakdown table.
  const series = data?.months ?? [];
  const costsAvailable = !!data?.costsAvailable;
  const hasData = series.length > 0;
  const filteredTotal = hasData ? annualTotal(series) : ZERO;
  const filteredHasRevenue = filteredTotal.revenue > 0;
  const filteredMargin =
    filteredTotal.revenue > 0
      ? ((filteredTotal.profit / filteredTotal.revenue) * 100).toFixed(1)
      : '0';

  // Fixed last-12-months — KPI cards (independent of the date filter).
  const annualSeries = annualData?.months ?? [];
  const annualCostsAvailable = !!annualData?.costsAvailable;
  const annual = annualSeries.length ? annualTotal(annualSeries) : ZERO;
  // "has revenue" over the rolling year drives the page-level empty state.
  const hasRevenue = annual.revenue > 0;
  // "This month" = latest month of the fixed rolling series (current month).
  const latest = annualSeries.length ? annualSeries[annualSeries.length - 1] : null;
  const annualMargin =
    annual.revenue > 0 ? ((annual.profit / annual.revenue) * 100).toFixed(1) : '0';
  // Avg monthly = rolling-year revenue spread across the months that actually
  // have revenue (so a partial-year practice isn't divided by a flat 12).
  const revenueMonths = annualSeries.filter((m) => m.revenue > 0).length;
  const avgMonthlyRevenue = revenueMonths > 0 ? Math.round(annual.revenue / revenueMonths) : 0;

  const chartData = series.map((m) => ({
    month: monthShort(m.month),
    Revenue: m.revenue,
    Profit: m.profit,
  }));

  function exportPdf() {
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const rows = series
      .slice()
      .reverse()
      .map(
        (m) => `<tr><td>${esc(monthLabel(m.month))}</td><td class=r>${poundsCompact(
          m.revenue,
        )}</td><td class=r>${poundsCompact(m.associate_pay)}</td><td class=r>${poundsCompact(
          m.staff_costs,
        )}</td><td class=r>${poundsCompact(m.lab_materials)}</td><td class=r>${poundsCompact(
          m.opex,
        )}</td><td class=r>${poundsCompact(m.profit)}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset=utf-8><title>P&L — ${new Date().toLocaleDateString(
      'en-GB',
    )}</title><style>body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;margin:32px}h1{font-size:20px;margin:0}.sub{color:var(--ink-muted);font-size:11px;margin:4px 0 20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 10px;border-bottom:1px solid var(--border);text-align:left}.r{text-align:right}tfoot td{font-weight:700;border-top:2px solid #1F2937}.f{color:#9CA3AF;font-size:10px;margin-top:18px}@media print{body{margin:14mm}}</style></head><body><h1>Profit &amp; Loss</h1><div class=sub>${
      rangeActive ? `${esc(range.from!)} to ${esc(range.to!)}` : '12-month rolling'
    } P&amp;L · ${esc(basisLabel)} · ${esc(
      new Date().toLocaleString('en-GB'),
    )}</div><table><thead><tr><th>Month</th><th class=r>Revenue</th><th class=r>Associate</th><th class=r>Staff</th><th class=r>Lab/mat</th><th class=r>OpEx</th><th class=r>Profit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>TOTAL</td><td class=r>${poundsCompact(
      filteredTotal.revenue,
    )}</td><td class=r>${poundsCompact(filteredTotal.associate_pay)}</td><td class=r>${poundsCompact(
      filteredTotal.staff_costs,
    )}</td><td class=r>${poundsCompact(filteredTotal.lab_materials)}</td><td class=r>${poundsCompact(
      filteredTotal.opex,
    )}</td><td class=r>${poundsCompact(filteredTotal.profit)}</td></tr></tfoot></table><div class=f>Elevate Dental OS — baseline-derived projection, not financial advice.</div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.onload = () => w.print();
    setTimeout(() => {
      try {
        w.print();
      } catch {
        /* closed */
      }
    }, 400);
  }

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-muted">
            12-month rolling P&amp;L · {basisLabel}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setPlModalOpen(true)}
            className="font-semibold"
            style={{
              padding: '9px 16px',
              fontSize: 13,
              border: 'none',
              borderRadius: 6,
              background: 'var(--brand)',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Enter actuals
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={!hasData}
            className="font-semibold"
            style={{
              padding: '9px 16px',
              fontSize: 13,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'white',
              opacity: hasData ? 1 : 0.5,
              cursor: hasData ? 'pointer' : 'default',
            }}
          >
            Export to PDF
          </button>
        </div>
      </div>

      <ManualPLModal open={plModalOpen} onClose={() => setPlModalOpen(false)} practiceId={practiceId} />

      <ProfitSourceBar
        source={source}
        onSourceChange={setSource}
        accountId={qboAccountId}
        onAccountChange={setQboAccountId}
      />
      {/* QuickBooks is scoped by company, not practice — hide the practice tabs. */}
      {source !== 'quickbooks' && <PracticeTabs value={practiceId} onChange={setPracticeId} />}
      <DateRangeFilter value={range} onChange={setRange} />

      <FinanceToolbar />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load P&amp;L</div>
          <div className="text-sm text-ink-muted">
            The analytics service did not respond. Refresh to retry.
          </div>
        </div>
      )}
      {!hasRevenue && !isError && !isLoading && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          {source === 'quickbooks' ? (
            <>
              <div className="font-semibold">No QuickBooks P&amp;L in the last 12 months</div>
              <div className="text-sm text-ink-muted">
                This view is built only from connected QuickBooks companies
                {qboAccountId ? ' (selected company)' : ''}. Connect a QuickBooks
                company and sync, or switch the data source above.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">No settled payments in the last 12 months</div>
              <div className="text-sm text-ink-muted">
                Revenue here is real settled payments
                {practiceId ? ' for this practice' : ''}. Once Dentally/Stripe
                payments land, the P&amp;L fills in automatically.
              </div>
            </>
          )}
        </div>
      )}
      {!costsAvailable && !isError && !isLoading && hasRevenue && source !== 'quickbooks' && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">Costs &amp; profit shown as £0</div>
          <div className="text-sm text-ink-muted">
            Revenue is real (settled payments). We have no cost data — Dentally
            doesn&rsquo;t provide it — so cost and profit lines are £0, not
            estimated.
            {source === 'dentally'
              ? ' Switch to QuickBooks or Combined for cost data.'
              : ' Connect Xero/QuickBooks or enter P&L actuals for real costs.'}
          </div>
        </div>
      )}

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          label="Annual revenue"
          value={annualLoading ? '…' : poundsCompact(annual.revenue)}
          delta="Real · last 12 months"
        />
        <Kpi
          label="Annual profit"
          value={annualLoading ? '…' : poundsCompact(annual.profit)}
          delta={annualCostsAvailable ? `${annualMargin}% margin` : 'no cost data (£0)'}
        />
        <Kpi
          label="Avg monthly revenue"
          value={annualLoading ? '…' : poundsCompact(avgMonthlyRevenue)}
          delta={revenueMonths > 0 ? `over ${revenueMonths} mo with revenue` : undefined}
        />
        <Kpi
          label={rangeActive ? 'Selected period' : 'This month'}
          value={
            rangeActive
              ? isLoading
                ? '…'
                : poundsCompact(filteredTotal.revenue)
              : annualLoading
                ? '…'
                : poundsCompact(latest?.revenue ?? 0)
          }
          delta={
            rangeActive
              ? series.length === 1
                ? monthLabel(series[0].month)
                : `${series.length} months`
              : latest
                ? monthLabel(latest.month)
                : undefined
          }
        />
      </div>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">
          Revenue &amp; profit — {rangeActive ? 'selected period' : 'last 12 months'}
        </h2>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : !filteredHasRevenue ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No settled payments in {rangeActive ? 'the selected period' : 'the last 12 months'}
            {practiceId ? ' for this practice.' : '.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => poundsCompact(v)}
                width={56}
              />
              <Tooltip
                formatter={(v: number, name: string) => [poundsCompact(v), name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="Revenue" fill={BRAND} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Profit" fill={ACCENT} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h2 className="display text-lg font-semibold">Monthly P&amp;L breakdown</h2>
          </div>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 24px' }}>Month</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Revenue</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Associate pay</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Staff</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Lab/materials</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>OpEx</th>
                <th className="text-right" style={{ padding: '10px 16px' }}>Profit</th>
                <th className="text-right" style={{ padding: '10px 24px' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {series
                .slice()
                .reverse()
                .map((m) => {
                  const margin =
                    m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(1) : '0';
                  return (
                    <tr key={m.month} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 24px' }}>
                        <strong>{monthLabel(m.month)}</strong>
                      </td>
                      <td className="text-right" style={{ padding: '10px 16px' }}>
                        {poundsCompact(m.revenue)}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {costsAvailable ? poundsCompact(m.associate_pay) : '—'}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {costsAvailable ? poundsCompact(m.staff_costs) : '—'}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {costsAvailable ? poundsCompact(m.lab_materials) : '—'}
                      </td>
                      <td className="text-right text-ink-muted" style={{ padding: '10px 16px' }}>
                        {costsAvailable ? poundsCompact(m.opex) : '—'}
                      </td>
                      <td
                        className={`text-right font-semibold ${costsAvailable ? '' : 'text-ink-muted'}`}
                        style={{ padding: '10px 16px', color: costsAvailable ? 'var(--success)' : undefined }}
                      >
                        {costsAvailable ? poundsCompact(m.profit) : '—'}
                      </td>
                      <td className="text-right" style={{ padding: '10px 24px' }}>
                        {costsAvailable ? (
                          <span
                            className={`chip ${
                              parseFloat(margin) >= 10 ? 'chip-emerald' : 'chip-amber'
                            }`}
                          >
                            {margin}%
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              <tr className="bg-bg font-bold">
                <td style={{ padding: '10px 24px' }}>
                  {rangeActive ? `TOTAL (${series.length}mo selected)` : 'TOTAL (12mo)'}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {poundsCompact(filteredTotal.revenue)}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {costsAvailable ? poundsCompact(filteredTotal.associate_pay) : '—'}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {costsAvailable ? poundsCompact(filteredTotal.staff_costs) : '—'}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {costsAvailable ? poundsCompact(filteredTotal.lab_materials) : '—'}
                </td>
                <td className="text-right" style={{ padding: '10px 16px' }}>
                  {costsAvailable ? poundsCompact(filteredTotal.opex) : '—'}
                </td>
                <td
                  className={`text-right ${costsAvailable ? '' : 'text-ink-muted'}`}
                  style={{ padding: '10px 16px', color: costsAvailable ? 'var(--success)' : undefined }}
                >
                  {costsAvailable ? poundsCompact(filteredTotal.profit) : '—'}
                </td>
                <td className="text-right" style={{ padding: '10px 24px' }}>
                  {costsAvailable ? (
                    <span className="chip chip-emerald">{filteredMargin}%</span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
