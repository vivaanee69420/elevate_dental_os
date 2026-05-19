'use client';
// Associate Pay Run — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.pay). Draft monthly pay run with lab-cost deductions.
//
// Data flow (per associate):
//   gross         = period_prod * pay_pct/100
//   lab_deduction = period_lab  * lab_pct/100
//   net           = gross - lab_deduction + prev (prior-period adjustment)
// Totals are the column sums; "% of production" = totalGross / sum(period_prod).
//
// Fed by ../data PAY_RUN_INPUTS; swap to a real /pay-runs endpoint later.
import { useMemo } from 'react';
import { PAY_RUN_INPUTS, formatPoundsCompact } from '../data';
import { formatPounds } from '@/features/_mock';

const NEG = '#EF4444';
const BRAND = '#0E7C7B';

/** Associate Pay Run screen. */
export default function PayScreen() {
  // Derive per-row gross/lab/net plus the column totals.
  const { rows, totalGross, totalLab, totalNet, pctOfProduction } = useMemo(() => {
    const computed = PAY_RUN_INPUTS.map((a) => {
      const gross = a.period_prod * (a.pay_pct / 100);
      const lab_deduction = a.period_lab * (a.lab_pct / 100);
      return { ...a, gross, lab_deduction, net: gross - lab_deduction + a.prev };
    });
    const tGross = computed.reduce((s, a) => s + a.gross, 0);
    const tLab = computed.reduce((s, a) => s + a.lab_deduction, 0);
    const tNet = computed.reduce((s, a) => s + a.net, 0);
    const tProd = computed.reduce((s, a) => s + a.period_prod, 0);
    return {
      rows: computed,
      totalGross: tGross,
      totalLab: tLab,
      totalNet: tNet,
      pctOfProduction: tProd ? (tGross / tProd) * 100 : 0,
    };
  }, []);

  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6B7280',
    fontWeight: 600,
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Associate Pay Run
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              May 2026 · Draft · 8 associates
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" style={{ fontSize: 13 }}>
              Upload lab invoices
            </button>
            <button className="btn-primary" style={{ fontSize: 13 }}>
              Approve &amp; export
            </button>
          </div>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Gross pay
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalGross)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Lab deductions
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalLab)}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: NEG }}>
            50% split
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Net to associates
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalNet)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            % of production
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {pctOfProduction.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Pay-run table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          className="flex justify-between items-center"
          style={{ padding: '14px 20px', borderBottom: '1px solid #E5E7EB' }}
        >
          <h2 className="display font-bold" style={{ fontSize: 17 }}>
            May 2026 pay run
          </h2>
          <span className="chip chip-amber">Draft</span>
        </div>
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead className="bg-bg" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <tr>
              <th className="text-left" style={th}>
                Associate
              </th>
              <th className="text-left" style={th}>
                Practice
              </th>
              {['Production', 'Pay %', 'Gross', 'Lab cost', 'Lab deduct', 'Prev', 'Net pay'].map(
                (h) => (
                  <th key={h} className="text-right" style={th}>
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.name} style={{ borderBottom: '1px solid #E5E7EB' }}>
                <td style={{ padding: '12px 16px' }}>
                  <strong>{a.name}</strong>
                </td>
                <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                  {a.practice}
                </td>
                <td className="text-right" style={{ padding: '12px 16px' }}>
                  {formatPounds(a.period_prod)}
                </td>
                <td className="text-right" style={{ padding: '12px 16px' }}>
                  {a.pay_pct}%
                </td>
                <td className="text-right" style={{ padding: '12px 16px' }}>
                  {formatPounds(a.gross)}
                </td>
                <td className="text-right text-ink-muted" style={{ padding: '12px 16px' }}>
                  {formatPounds(a.period_lab)}
                </td>
                <td className="text-right" style={{ padding: '12px 16px', color: NEG }}>
                  −{formatPounds(a.lab_deduction)}
                </td>
                <td
                  className="text-right"
                  style={{ padding: '12px 16px', color: a.prev < 0 ? NEG : '#6B7280' }}
                >
                  {a.prev === 0 ? '—' : formatPounds(a.prev)}
                </td>
                <td
                  className="text-right"
                  style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, color: BRAND }}
                >
                  {formatPounds(a.net)}
                </td>
              </tr>
            ))}
            <tr className="bg-bg" style={{ fontWeight: 700 }}>
              <td colSpan={4} style={{ padding: '12px 16px' }}>
                TOTAL
              </td>
              <td className="text-right" style={{ padding: '12px 16px' }}>
                {formatPounds(totalGross)}
              </td>
              <td className="text-right" colSpan={2} style={{ padding: '12px 16px', color: NEG }}>
                −{formatPounds(totalLab)}
              </td>
              <td />
              <td
                className="text-right"
                style={{ padding: '12px 16px', fontSize: 15, color: BRAND }}
              >
                {formatPounds(totalNet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
