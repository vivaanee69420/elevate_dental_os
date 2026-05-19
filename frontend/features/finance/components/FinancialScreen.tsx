'use client';
// Financial Statements — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.financial). Balance sheet,
// director loan account, and annual P&L summary. Fed by the finance
// mock-data layer; swap to a real ledger / balance-sheet endpoint when
// one exists server-side.
//
// Data flow:
//   FINANCE_SERIES ──> annualTotal() ──> annual P&L summary table
//   static balance-sheet figures (debtors keyed off annual revenue)
//                  ──> KPI strip + balance sheet card

import { useMemo } from 'react';
import { FINANCE_SERIES, annualTotal } from '../mock';

// Full pounds with en-GB grouping (project rule 2) — prototype formatPounds.
function fmt(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

// One KPI card in the prototype's 4-up strip (label / value / optional delta).
function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && (
        <div className="text-xs font-semibold mt-1" style={{ color: '#10B981' }}>
          {delta}
        </div>
      )}
    </div>
  );
}

// One label/value row inside the balance sheet (prototype .pnl-row).
function Row({
  label,
  value,
  strong,
  brand,
  style,
}: {
  label: string;
  value: string;
  strong?: boolean;
  brand?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="flex justify-between items-center"
      style={{ padding: '6px 0', fontWeight: strong ? 700 : 400, ...style }}
    >
      <span style={{ color: brand ? 'var(--brand)' : strong ? undefined : 'var(--ink-muted)' }}>
        {label}
      </span>
      <span
        style={{
          color: brand ? 'var(--brand)' : undefined,
          fontFamily: brand ? 'var(--font-display), serif' : undefined,
          fontSize: brand ? 16 : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Financial Statements page: balance sheet, director loan, annual P&L.
export default function FinancialScreen() {
  // Annual P&L totals + static balance-sheet figures (debtors scale off
  // annual revenue, mirroring the prototype).
  const { annual, bs } = useMemo(() => {
    const annual = annualTotal(FINANCE_SERIES);
    const cash = 287000;
    const debtors = Math.round(annual.revenue * 0.04);
    const stock = 18000;
    const equipment = 380000;
    const totalAssets = cash + debtors + stock + equipment;
    const tradeCreditors = 42000;
    const accruals = 28000;
    const loans = 180000;
    const directorLoan = -45000;
    const totalLiabilities = tradeCreditors + accruals + loans;
    return {
      annual,
      bs: {
        cash,
        debtors,
        stock,
        equipment,
        totalAssets,
        tradeCreditors,
        accruals,
        loans,
        directorLoan,
        totalLiabilities,
        netAssets: totalAssets - totalLiabilities,
      },
    };
  }, []);

  const asOf = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Annual P&L summary rows (line, annual, % of revenue, per-practice /5).
  const plRows: { label: string; amount: number; strong?: boolean; brand?: boolean }[] = [
    { label: 'Revenue', amount: annual.revenue, strong: true, brand: true },
    { label: 'Associate pay', amount: annual.associate_pay },
    { label: 'Staff costs', amount: annual.staff_costs },
    { label: 'Lab + materials', amount: annual.lab_materials },
    { label: 'OpEx', amount: annual.opex },
    { label: 'Net profit', amount: annual.profit, strong: true },
  ];

  // Director loan account ledger (static demo movements).
  const loanRows = [
    { date: '02 May 2026', desc: 'Director drawing', amount: -8000 },
    { date: '28 Mar 2026', desc: 'Equipment (your card)', amount: 18500 },
    { date: '12 Mar 2026', desc: 'Director drawing', amount: -10000 },
    { date: '22 Feb 2026', desc: 'Cash injection', amount: 25000 },
  ];

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Financial Statements</h1>
        <p className="text-sm text-ink-muted">
          Balance sheet · Director loan account · Annual summary
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Total assets" value={fmt(bs.totalAssets)} />
        <Kpi label="Total liabilities" value={fmt(bs.totalLiabilities)} />
        <Kpi label="Net worth (book)" value={fmt(bs.netAssets)} delta="Equity" />
        <Kpi label="Director loan" value={fmt(Math.abs(bs.directorLoan))} delta="Owed to you" />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Balance sheet */}
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">Balance sheet — {asOf}</h2>
          <div style={{ fontSize: 13 }}>
            <div className="font-semibold mb-2">Assets</div>
            <Row label="Cash at bank" value={fmt(bs.cash)} />
            <Row label="Trade debtors" value={fmt(bs.debtors)} />
            <Row label="Stock / consumables" value={fmt(bs.stock)} />
            <Row label="Equipment (net)" value={fmt(bs.equipment)} />
            <Row
              label="Total assets"
              value={fmt(bs.totalAssets)}
              strong
              style={{ borderTop: '2px solid var(--border)', paddingTop: 8 }}
            />

            <div className="font-semibold" style={{ margin: '18px 0 8px' }}>
              Liabilities
            </div>
            <Row label="Trade creditors" value={fmt(bs.tradeCreditors)} />
            <Row label="Accruals" value={fmt(bs.accruals)} />
            <Row label="Bank loans" value={fmt(bs.loans)} />
            <Row
              label="Total liabilities"
              value={fmt(bs.totalLiabilities)}
              strong
              style={{ borderTop: '2px solid var(--border)', paddingTop: 8 }}
            />

            <Row
              label="Net assets"
              value={fmt(bs.netAssets)}
              brand
              strong
              style={{
                borderTop: '3px double var(--brand)',
                paddingTop: 12,
                marginTop: 8,
              }}
            />
          </div>
        </div>

        {/* Director loan account */}
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">Director loan account</h2>
          <div
            className="bg-bg"
            style={{ borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'center' }}
          >
            <div className="text-ink-muted" style={{ fontSize: 12 }}>
              Balance owed to you
            </div>
            <div
              className="display"
              style={{ fontSize: 32, fontWeight: 600, color: 'var(--success)', marginTop: 4 }}
            >
              {fmt(Math.abs(bs.directorLoan))}
            </div>
            <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 4 }}>
              CR balance — withdraw tax-free
            </div>
          </div>
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead className="bg-bg">
              <tr>
                <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Description</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {loanRows.map((r) => (
                <tr key={r.date + r.desc}>
                  <td style={{ padding: 8 }}>{r.date}</td>
                  <td style={{ padding: 8 }}>{r.desc}</td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      color: r.amount < 0 ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    {r.amount < 0 ? '−' : '+'}
                    {fmt(Math.abs(r.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Annual P&L summary */}
      <div className="card-padded">
        <h2 className="display text-lg font-semibold mb-4">Annual P&amp;L summary</h2>
        <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
              <th style={{ padding: '10px 8px' }}>Line</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Annual</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>% of revenue</th>
              <th className="text-right" style={{ padding: '10px 8px' }}>Per practice</th>
            </tr>
          </thead>
          <tbody>
            {plRows.map((r) => {
              const isProfit = r.label === 'Net profit';
              return (
                <tr
                  key={r.label}
                  className={isProfit ? 'bg-bg' : ''}
                  style={{
                    fontWeight: r.strong ? 700 : 400,
                    borderTop: isProfit ? undefined : '1px solid var(--border)',
                  }}
                >
                  <td style={{ padding: '10px 8px' }}>
                    {r.strong ? <strong>{r.label}</strong> : r.label}
                  </td>
                  <td
                    className="text-right"
                    style={{
                      padding: '10px 8px',
                      fontWeight: r.brand || isProfit ? 600 : undefined,
                      color: r.brand
                        ? 'var(--brand)'
                        : isProfit
                          ? 'var(--success)'
                          : undefined,
                    }}
                  >
                    {fmt(r.amount)}
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px' }}>
                    {r.label === 'Revenue'
                      ? '100%'
                      : `${((r.amount / annual.revenue) * 100).toFixed(1)}%`}
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px' }}>
                    {fmt(r.amount / 5)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
