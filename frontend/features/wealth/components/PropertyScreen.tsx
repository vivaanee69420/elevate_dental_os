'use client';
// Property Portfolio — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES['wealth-prop']). 4-KPI summary
// plus a card per property.
//
// Data flow:
//   totalValue    = sum(PROPERTIES.value)
//   totalMortgage = sum(PROPERTIES.mortgage)
//   totalEquity   = totalValue - totalMortgage
//   monthlyRental = sum(PROPERTIES.monthly_income)
//
// Fed by ../data PROPERTIES; swap to a real /wealth/property endpoint when
// it exists. Owner-only screen.
import { useMemo } from 'react';
import { PROPERTIES, formatPounds, formatPoundsCompact } from '../data';

/** Property Portfolio screen. */
export default function PropertyScreen() {
  // Portfolio roll-ups (prototype arithmetic).
  const { totalValue, totalMortgage, totalEquity, monthlyRental } = useMemo(
    () => {
      const v = PROPERTIES.reduce((s, p) => s + p.value, 0);
      const m = PROPERTIES.reduce((s, p) => s + p.mortgage, 0);
      return {
        totalValue: v,
        totalMortgage: m,
        totalEquity: v - m,
        monthlyRental: PROPERTIES.reduce((s, p) => s + p.monthly_income, 0),
      };
    },
    []
  );

  const kpiLabel: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.05em',
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Property Portfolio
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              {PROPERTIES.length} properties ·{' '}
              {formatPoundsCompact(totalEquity)} equity
            </p>
          </div>
          <button className="btn-primary" style={{ fontSize: 13 }}>
            + Add property
          </button>
        </div>
      </div>

      {/* 4 KPIs */}
      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Portfolio value
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalValue)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Total mortgages
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalMortgage)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Net equity
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalEquity)}
          </div>
          <div
            className="font-bold text-success"
            style={{ fontSize: 12, marginTop: 4 }}
          >
            {((totalEquity / totalValue) * 100).toFixed(0)}% LTV inverse
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={kpiLabel}>
            Monthly rental
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPounds(monthlyRental)}
          </div>
        </div>
      </div>

      {/* Property cards */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {PROPERTIES.map((p) => (
          <div key={p.name} className="card-padded">
            <div
              className="flex justify-between"
              style={{ marginBottom: 12 }}
            >
              <div>
                <h3 className="display font-bold" style={{ fontSize: 16 }}>
                  {p.name}
                </h3>
                <div className="text-ink-muted" style={{ fontSize: 12 }}>
                  {p.address}
                </div>
              </div>
              <span
                className={`chip ${
                  p.type === 'Residential' ? 'chip-brand' : 'chip-emerald'
                }`}
              >
                {p.type}
              </span>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                fontSize: 13,
              }}
            >
              <div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  Current value
                </div>
                <div style={{ fontWeight: 600 }}>
                  {formatPoundsCompact(p.value)}
                </div>
              </div>
              <div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  Mortgage outstanding
                </div>
                <div style={{ fontWeight: 600 }}>
                  {formatPoundsCompact(p.mortgage)}
                </div>
              </div>
              <div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  Equity
                </div>
                <div className="text-success" style={{ fontWeight: 600 }}>
                  {formatPoundsCompact(p.value - p.mortgage)}
                </div>
              </div>
              <div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  {p.yield !== null ? 'Yield' : 'Monthly cost'}
                </div>
                <div style={{ fontWeight: 600 }}>
                  {p.yield !== null
                    ? `${p.yield}%`
                    : `${formatPounds(p.monthly_cost)}/mo`}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
