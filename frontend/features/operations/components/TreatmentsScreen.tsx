'use client';
// Treatment Mix — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.treatments). Revenue / margin / volume by treatment, TTM.
//
// Data flow:
//   leads (treatment-tagged, started)         [../data treatmentLeads()]
//      -> group by treatment: { leads, revenue=sum(value), avgCase }
//      -> attach margin_pct from MARGINS, profit = round(revenue*margin)
//      -> sort by revenue desc
//   totalRevenue / totalProfit = column sums; share = revenue/totalRevenue
//
// Synthesised population (the prototype's gzipped dataset is not decodable
// here); swap to a real /treatments endpoint when it exists.
import { useMemo } from 'react';
import { treatmentLeads, formatPoundsCompact } from '../data';

const POS = '#10B981';

// Gross margin per treatment (verbatim from the prototype), default 0.40.
const MARGINS: Record<string, number> = {
  'All-on-4 Implants': 0.42,
  'Single Tooth Implant': 0.38,
  Invisalign: 0.45,
  'Composite Bonding': 0.55,
  'Porcelain Veneers': 0.4,
  'Teeth Whitening': 0.65,
};

interface TreatmentRow {
  name: string;
  leads: number;
  revenue: number;
  value: number;
  margin_pct: number;
  profit: number;
}

/** Treatment Mix screen. */
export default function TreatmentsScreen() {
  // Aggregate the started-treatment leads into the per-treatment table.
  const { treatments, totalRevenue, totalProfit, topMargin } = useMemo(() => {
    const leads = treatmentLeads().filter((l) =>
      ['treatment_started', 'treatment_completed'].includes(l.status)
    );
    const stats: Record<string, { name: string; leads: number; revenue: number; value: number }> = {};
    leads.forEach((l) => {
      if (!stats[l.treatment])
        stats[l.treatment] = { name: l.treatment, leads: 0, revenue: 0, value: l.value };
      stats[l.treatment].leads++;
      stats[l.treatment].revenue += l.value;
    });
    const rows: TreatmentRow[] = Object.values(stats)
      .map((t) => {
        const m = MARGINS[t.name] ?? 0.4;
        return { ...t, margin_pct: m * 100, profit: Math.round(t.revenue * m) };
      })
      .sort((a, b) => b.revenue - a.revenue);
    const tRev = rows.reduce((s, t) => s + t.revenue, 0);
    const tProfit = rows.reduce((s, t) => s + t.profit, 0);
    const byMargin = [...rows].sort((a, b) => b.margin_pct - a.margin_pct);
    return {
      treatments: rows,
      totalRevenue: tRev,
      totalProfit: tProfit,
      topMargin: byMargin[0]?.name || '—',
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
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Treatment Mix
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Revenue, margin, and volume by treatment · TTM
        </p>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            TTM revenue
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalRevenue)}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Total profit
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(totalProfit)}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            {totalRevenue ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0'}% margin
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Top treatment
          </div>
          <div className="display font-bold" style={{ fontSize: 16, marginTop: 4 }}>
            {treatments[0]?.name || '—'}
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Highest margin
          </div>
          <div className="display font-bold" style={{ fontSize: 16, marginTop: 4 }}>
            {topMargin}
          </div>
        </div>
      </div>

      {/* Performance table */}
      <div className="card-padded">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          Treatment performance
        </h2>
        <table className="w-full" style={{ fontSize: 13, margin: -16, width: 'calc(100% + 32px)' }}>
          <thead className="bg-bg" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <tr>
              <th className="text-left" style={th}>
                Treatment
              </th>
              {['Volume', 'Avg case', 'Revenue', 'Margin', 'Profit'].map((h) => (
                <th key={h} className="text-right" style={th}>
                  {h}
                </th>
              ))}
              <th className="text-left" style={th}>
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {treatments.map((t) => {
              const share = totalRevenue ? (t.revenue / totalRevenue) * 100 : 0;
              const chip =
                t.margin_pct >= 50
                  ? 'chip-emerald'
                  : t.margin_pct >= 40
                  ? 'chip-brand'
                  : 'chip-amber';
              return (
                <tr key={t.name} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong>{t.name}</strong>
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {t.leads}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    {formatPoundsCompact(t.value)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px', fontWeight: 600 }}>
                    {formatPoundsCompact(t.revenue)}
                  </td>
                  <td className="text-right" style={{ padding: '12px 16px' }}>
                    <span className={`chip ${chip}`}>{t.margin_pct.toFixed(0)}%</span>
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '12px 16px', fontWeight: 600, color: POS }}
                  >
                    {formatPoundsCompact(t.profit)}
                  </td>
                  <td style={{ padding: '12px 16px', width: 180 }}>
                    <div style={{ height: 8, background: '#F9FAFB', borderRadius: 4 }}>
                      <div
                        style={{
                          height: '100%',
                          background: '#0E7C7B',
                          width: `${share}%`,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {share.toFixed(1)}%
                    </div>
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
