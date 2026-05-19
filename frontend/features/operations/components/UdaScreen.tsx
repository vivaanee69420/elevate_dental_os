'use client';
// UDA Tracker — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.uda). NHS Units of Dental Activity vs the annual contract.
//
// Data flow (fixed prototype constants, 75% = expected progress to date):
//   target_to_date     = totalContract * 0.75
//   projected_year_end = delivered / 0.75
//   clawback_risk      = max(0, totalContract - projected_year_end)
//   variance_pct       = (delivered - target_to_date) / target_to_date * 100
//   clawback £ value   = clawback_risk * £28/UDA
// Per practice: pct = delivered/contract; a 75% marker line on each bar.
//
// Fed by ../data PRACTICE_UDA; swap to a real /uda endpoint when it exists.
import { useMemo } from 'react';
import { PRACTICE_UDA, formatPoundsCompact } from '../data';

const TOTAL_CONTRACT = 32000;
const DELIVERED = 18400;

// Static recovery-plan bullets (verbatim from the prototype).
const RECOVERY = [
  { label: 'Rochester:', text: 'Biggest gap (4,800 UDAs). Saturday clinics or locum cover.' },
  { label: 'Barnet:', text: '2,900 UDAs needed. Push exam reminders to lapsed NHS patients.' },
  { label: 'Bexleyheath:', text: '2,800 UDAs needed. Already strong, maintain pace.' },
];

/** UDA Tracker screen. */
export default function UdaScreen() {
  // Contract-vs-delivery projections (prototype arithmetic).
  const v = useMemo(() => {
    const target_to_date = TOTAL_CONTRACT * 0.75;
    const projected_year_end = DELIVERED / 0.75;
    const clawback_risk = Math.max(0, TOTAL_CONTRACT - projected_year_end);
    const variance_pct = ((DELIVERED - target_to_date) / target_to_date) * 100;
    return { target_to_date, projected_year_end, clawback_risk, variance_pct };
  }, []);

  const remaining = TOTAL_CONTRACT - DELIVERED;

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          UDA Tracker
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          NHS Units of Dental Activity · contract year ending 31 Mar 2026
        </p>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Contract UDAs
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {TOTAL_CONTRACT.toLocaleString('en-GB')}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Delivered
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {DELIVERED.toLocaleString('en-GB')}
          </div>
          <div
            className="font-bold"
            style={{ fontSize: 12, marginTop: 4, color: v.variance_pct >= 0 ? '#10B981' : '#EF4444' }}
          >
            {v.variance_pct >= 0 ? '+' : ''}
            {v.variance_pct.toFixed(1)}% vs target
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Year-end projection
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {v.projected_year_end.toFixed(0)}
          </div>
          <div
            className="font-bold"
            style={{
              fontSize: 12,
              marginTop: 4,
              color: v.projected_year_end >= TOTAL_CONTRACT ? '#10B981' : '#EF4444',
            }}
          >
            {((v.projected_year_end / TOTAL_CONTRACT) * 100).toFixed(0)}% of target
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Clawback risk
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(v.clawback_risk * 28)}
          </div>
          <div
            className="font-bold"
            style={{ fontSize: 12, marginTop: 4, color: v.clawback_risk > 0 ? '#EF4444' : '#10B981' }}
          >
            {v.clawback_risk > 0 ? `${v.clawback_risk.toFixed(0)} UDAs short` : 'On track'}
          </div>
        </div>
      </div>

      {/* Per-practice delivery progress */}
      <div className="card-padded mb-4">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          Delivery progress (NHS-contracted practices)
        </h2>
        {PRACTICE_UDA.map((p) => {
          const pct = (p.delivered / p.contract) * 100;
          const colour =
            pct >= 75 ? 'var(--success)' : pct >= 70 ? 'var(--accent)' : 'var(--danger)';
          return (
            <div key={p.name} style={{ marginBottom: 16 }}>
              <div className="flex justify-between" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>{p.name}</strong>
                <span className="text-ink-muted" style={{ fontSize: 12 }}>
                  {p.delivered.toLocaleString('en-GB')} / {p.contract.toLocaleString('en-GB')} (
                  {pct.toFixed(0)}%) · £{p.rate}/UDA
                </span>
              </div>
              <div
                style={{
                  height: 12,
                  background: '#F9FAFB',
                  borderRadius: 6,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{ height: '100%', background: colour, width: `${pct}%`, borderRadius: 6 }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: '75%',
                    width: 2,
                    background: '#1F2937',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recovery plan */}
      <div className="card-padded">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 12 }}>
          Recovery plan
        </h2>
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          To hit contract, you need <strong>{remaining.toFixed(0)} more UDAs</strong> in remaining
          3 months — <strong>{Math.round(remaining / 3)}/month</strong>.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, fontSize: 13 }}>
          {RECOVERY.map((r) => (
            <li key={r.label} style={{ padding: '6px 0' }}>
              • <strong>{r.label}</strong> {r.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
