'use client';
// Debt Recovery — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.debt). Aged debtors, payment plans, write-offs. Static mock data
// (no backend); see ../data.ts.
//
// Data-flow:
//
//   DEBTORS ──┬─► total = Σ amount ──────────────► "Outstanding" KPI
//             ├─► aged buckets by `age` days ────► aged-debtor cards
//             │     0-30 / 31-60 / 61-90 / 91-120 / 120+
//             ├─► 90+ overdue = Σ(91-120, 120+) ─► "90+ days" KPI
//             └─► sorted by age desc ────────────► outstanding-debtors table
//
// (No emoji on the bulk-reminders button — project rule 7. The prototype
// shows one; intentionally omitted here.)

import { Card } from '@/components/ui';
import { formatPounds } from '@/features/_mock';
import { DEBTORS, formatPoundsCompact, type Debtor } from '../data';

// Total outstanding across all debtors.
const TOTAL = DEBTORS.reduce((s, d) => s + d.amount, 0);

// Aged-debtor buckets keyed by overdue-day band (prototype order).
const BUCKETS: { label: string; items: Debtor[]; colour: string }[] = [
  { label: '0-30', items: DEBTORS.filter((d) => d.age <= 30), colour: 'var(--success)' },
  { label: '31-60', items: DEBTORS.filter((d) => d.age > 30 && d.age <= 60), colour: 'var(--brand)' },
  { label: '61-90', items: DEBTORS.filter((d) => d.age > 60 && d.age <= 90), colour: 'var(--warning)' },
  { label: '91-120', items: DEBTORS.filter((d) => d.age > 90 && d.age <= 120), colour: 'var(--danger)' },
  { label: '120+', items: DEBTORS.filter((d) => d.age > 120), colour: 'var(--danger)' },
];

// Amount overdue by 90+ days (the two oldest buckets) — highest collection risk.
const OVERDUE_90 = BUCKETS.filter((b) => b.label === '91-120' || b.label === '120+')
  .flatMap((b) => b.items)
  .reduce((s, d) => s + d.amount, 0);

// Debtors sorted oldest-first for the outstanding table.
const SORTED = [...DEBTORS].sort((a, b) => b.age - a.age);

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
  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Debt Recovery</h1>
        <p className="text-sm text-ink-muted mt-1">
          Aged debtors &middot; payment plans &middot; write-offs
        </p>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}
      >
        <DebtKpi label="Outstanding" value={formatPoundsCompact(TOTAL)} />
        <DebtKpi
          label="90+ days overdue"
          value={formatPoundsCompact(OVERDUE_90)}
          sub="Highest risk"
          tone="down"
        />
        <DebtKpi label="Active payment plans" value="12" sub="£28k/mo" tone="up" />
        <DebtKpi label="Recovered TTM" value="£42k" sub="86% success" tone="up" />
      </div>

      <Card className="mb-4">
        <h2
          className="display font-semibold"
          style={{ fontSize: 17, marginBottom: 16 }}
        >
          Aged debtors
        </h2>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}
        >
          {BUCKETS.map((b) => {
            const sum = b.items.reduce((s, d) => s + d.amount, 0);
            return (
              <div
                key={b.label}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                <div
                  className="text-ink-muted uppercase"
                  style={{ fontSize: 11 }}
                >
                  {b.label} days
                </div>
                <div
                  className="display font-semibold"
                  style={{ fontSize: 22, color: b.colour, margin: '8px 0' }}
                >
                  {formatPoundsCompact(sum)}
                </div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  {b.items.length} {b.items.length === 1 ? 'debtor' : 'debtors'}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="card overflow-hidden">
        <div
          className="flex justify-between"
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
          }}
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
            {SORTED.map((d) => (
              <tr key={d.name}>
                <td>
                  <strong>{d.name}</strong>
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.practice}
                </td>
                <td className="text-ink-muted" style={{ fontSize: 12 }}>
                  {d.tx}
                </td>
                <td className="right" style={{ fontWeight: 700 }}>
                  {formatPounds(d.amount)}
                </td>
                <td className="right">
                  <span className={`chip ${ageChip(d.age)}`}>{d.age}d</span>
                </td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    Plan
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
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
