'use client';
// Associates — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.associates). Clinician roster with TTM production / conversion and
// a performance-status chip. Fed by the operations mock-data layer
// (../data); swap to a real /associates endpoint when it exists.
import { useMemo } from 'react';
import { ASSOCIATES, formatPoundsCompact } from '../data';

const NEG = '#EF4444';

// Map the prototype's status code to its chip colour + label.
function statusChip(status: 'top' | 'good' | 'review') {
  const chip = { top: 'chip-emerald', good: 'chip-brand', review: 'chip-rose' }[status];
  const label = { top: 'Top performer', good: 'On target', review: 'Review' }[status];
  return { chip, label };
}

/** Associates roster screen. */
export default function AssociatesScreen() {
  // Sort by production desc + derive the KPI totals (matches prototype).
  const { rows, total, avgConv, needReview } = useMemo(() => {
    const totalProduction = ASSOCIATES.reduce((s, a) => s + a.ttm_production, 0);
    const avgConversion =
      ASSOCIATES.reduce((s, a) => s + a.conversion, 0) / ASSOCIATES.length;
    const sorted = [...ASSOCIATES].sort((a, b) => b.ttm_production - a.ttm_production);
    return {
      rows: sorted,
      total: totalProduction,
      avgConv: avgConversion,
      needReview: ASSOCIATES.filter((a) => a.status === 'review').length,
    };
  }, []);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-end gap-4">
          <div>
            <h1 className="display font-bold" style={{ fontSize: 28 }}>
              Associates
            </h1>
            <p className="text-ink-muted" style={{ fontSize: 13 }}>
              {ASSOCIATES.length} clinicians · TTM production {formatPoundsCompact(total)}
            </p>
          </div>
          <button className="btn-primary" style={{ fontSize: 13 }}>
            + Add associate
          </button>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Total associates
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {ASSOCIATES.length}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            TTM production
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(total)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Avg conversion
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {avgConv.toFixed(1)}%
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Need review
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {needReview}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: NEG }}>
            Underperforming
          </div>
        </div>
      </div>

      {/* Roster table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead className="bg-bg" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <tr>
              <th className="text-left" style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', fontWeight: 600 }}>
                Associate
              </th>
              <th className="text-left" style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', fontWeight: 600 }}>
                Practice
              </th>
              {['Pay %', 'Production', 'UDAs', 'Conv.', 'Tx'].map((h) => (
                <th key={h} className="text-right" style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', fontWeight: 600 }}>
                  {h}
                </th>
              ))}
              <th className="text-left" style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', fontWeight: 600 }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const { chip, label } = statusChip(a.status);
              const joined = new Date(a.joined).toLocaleDateString('en-GB', {
                month: 'short',
                year: 'numeric',
              });
              return (
                <tr key={a.name} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong>{a.name}</strong>
                    <div className="text-ink-muted" style={{ fontSize: 11 }}>
                      Joined {joined}
                    </div>
                  </td>
                  <td className="text-ink-muted" style={{ padding: '12px 16px', fontSize: 12 }}>
                    {a.practice}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {a.pay_pct}%
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px', fontWeight: 600 }}>
                    {formatPoundsCompact(a.ttm_production)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {a.ttm_uda || '—'}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {a.conversion}%
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {a.treatments}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={`chip ${chip}`}>{label}</span>
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
