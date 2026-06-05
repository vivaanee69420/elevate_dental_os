'use client';
// Pensions — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['wealth-pen']). 4-KPI summary plus a per-scheme breakdown table.
//
// Data flow:
//   total         = sum(PENSIONS.balance)
//   contributions = sum(PENSIONS.contributions_ytd)
//   allowanceLeft = ANNUAL_ALLOWANCE - contributions
//   projected65   = total * 1.07^20   (7% growth, 20yr horizon)
//
// Fed by ../data PENSIONS / ANNUAL_ALLOWANCE; swap to a real
// /wealth/pensions endpoint when it exists. Owner-only screen.
import { useMemo } from 'react';
import {
  PENSIONS,
  ANNUAL_ALLOWANCE,
  formatPounds,
  formatPoundsCompact,
} from '../data';

/** Pensions screen. */
export default function PensionsScreen() {
  // Pot roll-ups + projection (prototype arithmetic).
  const { total, contributions, projected65 } = useMemo(() => {
    const t = PENSIONS.reduce((s, p) => s + p.balance, 0);
    return {
      total: t,
      contributions: PENSIONS.reduce((s, p) => s + p.contributions_ytd, 0),
      projected65: t * Math.pow(1.07, 20),
    };
  }, []);

  const kpiLabel: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.05em',
  };
  const th: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--ink-muted)',
    fontWeight: 600,
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Pensions
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          SIPP · NHS · Director pension tracking
        </p>
      </div>

      {/* 4 KPIs */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Total pension pot
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(total)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Contributions YTD
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(contributions)}
          </div>
          <div
            className="font-bold text-success"
            style={{ fontSize: 12, marginTop: 4 }}
          >
            {((contributions / ANNUAL_ALLOWANCE) * 100).toFixed(0)}% of
            allowance
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Annual allowance left
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(ANNUAL_ALLOWANCE - contributions)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Projected at 65
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(projected65)}
          </div>
          <div
            className="font-bold text-success"
            style={{ fontSize: 12, marginTop: 4 }}
          >
            7% growth assumption
          </div>
        </div>
      </div>

      {/* Pension breakdown */}
      <div className="card-padded">
        <h2
          className="display font-bold"
          style={{ fontSize: 17, marginBottom: 16 }}
        >
          Pension breakdown
        </h2>
        <div className="card" style={{ overflow: 'hidden', margin: -16 }}>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead
              className="bg-bg"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <tr>
                <th className="text-left" style={th}>
                  Scheme
                </th>
                <th className="text-left" style={th}>
                  Type
                </th>
                {['Balance', 'Contributions YTD', '% of pot'].map((h) => (
                  <th key={h} className="text-right" style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PENSIONS.map((p) => (
                <tr
                  key={p.name}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <strong>{p.name}</strong>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className="chip chip-brand">{p.type}</span>
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '12px 16px', fontWeight: 600 }}
                  >
                    {formatPounds(p.balance)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {formatPounds(p.contributions_ytd)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {((p.balance / total) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
