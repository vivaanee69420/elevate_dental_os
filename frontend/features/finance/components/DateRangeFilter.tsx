'use client';
// Reusable date-range filter for the Finance pages. Emits { from, to } as
// YYYY-MM-DD. Presets cover "this month" (the default), "this year", a specific
// month, and an arbitrary custom range (from–to). A single day = from === to.
// (The old "Recent"/rolling-default preset was removed — pages now default to
// the current month.)
import { useState } from 'react';

export interface DateRange {
  from: string | null;
  to: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function thisMonthRange(ref = new Date()): DateRange {
  return {
    from: fmt(new Date(ref.getFullYear(), ref.getMonth(), 1)),
    to: fmt(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)),
  };
}
export function thisYearRange(ref = new Date()): DateRange {
  return { from: `${ref.getFullYear()}-01-01`, to: `${ref.getFullYear()}-12-31` };
}
// A YYYY-MM month string → its first..last day.
function monthToRange(ym: string): DateRange {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: fmt(new Date(y, m, 0)) };
}

interface Props {
  value: DateRange;
  onChange: (r: DateRange) => void;
}

type Mode = 'month' | 'year' | 'pick-month' | 'custom';

export default function DateRangeFilter({ value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('month');

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: active ? 'var(--brand)' : 'white',
    color: active ? 'white' : 'var(--ink)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  const field: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6,
  };

  function pick(m: Mode) {
    setMode(m);
    if (m === 'month') onChange(thisMonthRange());
    else if (m === 'year') onChange(thisYearRange());
    // 'pick-month' and 'custom' wait for input below
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <button style={btn(mode === 'month')} onClick={() => pick('month')}>This month</button>
      <button style={btn(mode === 'year')} onClick={() => pick('year')}>This year</button>
      <button style={btn(mode === 'pick-month')} onClick={() => pick('pick-month')}>Pick month</button>
      <button style={btn(mode === 'custom')} onClick={() => pick('custom')}>Custom</button>

      {mode === 'pick-month' && (
        <input
          type="month"
          style={field}
          onChange={(e) => e.target.value && onChange(monthToRange(e.target.value))}
        />
      )}

      {mode === 'custom' && (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="date"
            style={field}
            value={value.from ?? ''}
            onChange={(e) => onChange({ from: e.target.value || null, to: value.to })}
          />
          <span className="text-ink-muted">to</span>
          <input
            type="date"
            style={field}
            value={value.to ?? ''}
            onChange={(e) => onChange({ from: value.from, to: e.target.value || null })}
          />
        </span>
      )}
    </div>
  );
}
