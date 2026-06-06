'use client';
// Debt Recovery — aged debtors from real Dentally invoices via /api/debt.
// (No emoji on the bulk-reminders button — project rule 7.)
//
// Note: "Active payment plans" and "Recovered TTM" KPIs have no Dentally data
// source yet (payment-plan/recovery feeds are out of scope) — left static.

import { Card } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useDebt, formatPenceCompact, type DebtBand } from '../debt-api';

// Band key -> chip/accent colour, mirroring the prototype thresholds.
const BAND_COLOUR: Record<string, string> = {
  '0-30': '#10B981',
  '31-60': '#0E7C7B',
  '61-90': '#F59E0B',
  '91-120': '#EF4444',
  '120+': '#EF4444',
};

/** Age-band -> chip colour, mirroring the prototype's thresholds. */
function ageChip(age: number): string {
  if (age > 90) return 'chip-rose';
  if (age > 60) return 'chip-amber';
  if (age > 30) return 'chip-purple';
  return 'chip-blue';
}

/** One KPI tile with optional sub-line. */
function DebtKpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {sub && <div className={`kpi-delta ${tone ?? ''}`.trim()}>{sub}</div>}
    </div>
  );
}

/** Debt Recovery page. */
export default function DebtScreen() {
  const { data, isLoading, isError, error } = useDebt();

  if (isLoading) {
    return (
      <div className="container mx-auto" style={{ maxWidth: 1500 }}>
        <p className="text-sm text-ink-muted">Loading debt recovery…</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="container mx-auto" style={{ maxWidth: 1500 }}>
        <p className="text-sm text-ink-muted">
          Could not load debt data: {(error as Error)?.message ?? 'unknown error'}
        </p>
      </div>
    );
  }

  const bands: DebtBand[] = data?.bands ?? [];
  const debtors = [...(data?.debtors ?? [])].sort((a, b) => b.age_days - a.age_days);

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Debt Recovery</h1>
        <p className="text-sm text-ink-muted mt-1">
          Aged debtors &middot; payment plans &middot; write-offs &middot; live from Dentally
        </p>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}
      >
        <DebtKpi label="Outstanding" value={formatPenceCompact(data?.outstanding_pence ?? 0)} />
        <DebtKpi
          label="90+ days overdue"
          value={formatPenceCompact(data?.overdue90_pence ?? 0)}
          sub="Highest risk"
          tone="down"
        />
        <DebtKpi label="Active payment plans" value="12" sub="£28k/mo" tone="up" />
        <DebtKpi label="Recovered TTM" value="£42k" sub="86% success" tone="up" />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 16 }}>
          Aged debtors
        </h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {bands.map((b) => (
            <div
              key={b.key}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 14,
                textAlign: 'center',
              }}
            >
              <div className="text-ink-muted uppercase" style={{ fontSize: 11 }}>
                {b.label}
              </div>
              <div
                className="display font-semibold"
                style={{ fontSize: 22, color: BAND_COLOUR[b.key] ?? '#0E7C7B', margin: '8px 0' }}
              >
                {formatPenceCompact(b.total_pence)}
              </div>
              <div className="text-ink-muted" style={{ fontSize: 11 }}>
                {b.count} {b.count === 1 ? 'debtor' : 'debtors'}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="card overflow-hidden">
        <div
          className="flex justify-between"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Outstanding debtors
          </h2>
          <button className="btn btn-ghost" style={{ fontSize: 12 }}>
            Bulk reminders
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Practice</th>
              <th>Treatment</th>
              <th className="right">Amount</th>
              <th className="right">Age</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {debtors.length === 0 && (
              <tr>
                <td colSpan={6} className="text-ink-muted" style={{ padding: '20px', textAlign: 'center' }}>
                  No outstanding debtors.
                </td>
              </tr>
            )}
            {debtors.map((d, i) => (
              <tr key={`${d.name}-${i}`}>
                <td>
                  <strong>{d.name}</strong>
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.practice ?? '—'}
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.treatment ?? '—'}
                </td>
                <td className="right" style={{ fontWeight: 700 }}>
                  {formatPence(d.amount_pence)}
                </td>
                <td className="right">
                  <span className={`chip ${ageChip(d.age_days)}`}>{d.age_days}d</span>
                </td>
                <td>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                    Plan
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                    Remind
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
