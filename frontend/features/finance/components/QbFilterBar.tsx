'use client';
// QuickBooks-style filter bar for the P&L page. Emits one QbFilters object:
// report period (DateRange; null=last 12 months), accounting method, columns-by,
// and the compare toggles. Pure controlled component — no data fetching.
import { useState } from 'react';
import type { DateRange } from './DateRangeFilter';
import { thisMonthRange, thisYearRange } from './DateRangeFilter';
import type { GroupBy } from '../pl-matrix';

export interface QbCompare {
  pctOfIncome: boolean;
  prevPeriod: boolean;
  prevYear: boolean;
}
export interface QbFilters {
  range: DateRange;            // {from:null,to:null} = last 12 months
  method: 'accrual' | 'cash';
  groupBy: GroupBy;
  compare: QbCompare;
}

export const DEFAULT_QB_FILTERS: QbFilters = {
  range: { from: null, to: null },
  method: 'accrual',
  groupBy: 'month',
  compare: { pctOfIncome: false, prevPeriod: false, prevYear: false },
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function lastNMonthsRange(n: number, ref = new Date()): DateRange {
  const to = fmt(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  const from = fmt(new Date(ref.getFullYear(), ref.getMonth() - (n - 1), 1));
  return { from, to };
}
function monthToRange(ym: string): DateRange {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: fmt(new Date(y, m, 0)) };
}

type PeriodPreset = 'recent' | 'this-month' | 'this-year' | 'last-12' | 'pick-month' | 'custom';

interface Props {
  value: QbFilters;
  onChange: (f: QbFilters) => void;
}

export default function QbFilterBar({ value, onChange }: Props) {
  const [preset, setPreset] = useState<PeriodPreset>('recent');

  const seg = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px', fontSize: 12, fontWeight: 600, borderRadius: 7,
    border: '1px solid var(--border)', background: active ? 'var(--brand)' : 'white',
    color: active ? 'white' : 'var(--ink)', cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const field: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6,
  };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginRight: 2 };
  const set = (patch: Partial<QbFilters>) => onChange({ ...value, ...patch });

  function pickPreset(pp: PeriodPreset) {
    setPreset(pp);
    if (pp === 'recent') set({ range: { from: null, to: null } });
    else if (pp === 'this-month') set({ range: thisMonthRange() });
    else if (pp === 'this-year') set({ range: thisYearRange() });
    else if (pp === 'last-12') set({ range: lastNMonthsRange(12) });
    // pick-month / custom wait for input
  }

  const wrap: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
  const row: React.CSSProperties = { ...wrap, marginBottom: 10 };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Report period */}
      <div style={row}>
        <span style={label}>Period</span>
        <button style={seg(preset === 'recent')} onClick={() => pickPreset('recent')}>Last 12mo</button>
        <button style={seg(preset === 'this-month')} onClick={() => pickPreset('this-month')}>This month</button>
        <button style={seg(preset === 'this-year')} onClick={() => pickPreset('this-year')}>This year</button>
        <button style={seg(preset === 'pick-month')} onClick={() => pickPreset('pick-month')}>Pick month</button>
        <button style={seg(preset === 'custom')} onClick={() => pickPreset('custom')}>Custom</button>
        {preset === 'pick-month' && (
          <input type="month" style={field}
            onChange={(e) => e.target.value && set({ range: monthToRange(e.target.value) })} />
        )}
        {preset === 'custom' && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="date" style={field} value={value.range.from ?? ''}
              onChange={(e) => set({ range: { from: e.target.value || null, to: value.range.to } })} />
            <span className="text-ink-muted">to</span>
            <input type="date" style={field} value={value.range.to ?? ''}
              onChange={(e) => set({ range: { from: value.range.from, to: e.target.value || null } })} />
          </span>
        )}
      </div>

      {/* Accounting method. Columns are fixed to a month view and the compare
          toggles were removed — the matrix is a straight month-by-month P&L. */}
      <div style={wrap}>
        <span style={label}>Method</span>
        <button style={seg(value.method === 'accrual')} onClick={() => set({ method: 'accrual' })}>Accrual</button>
        <button style={seg(value.method === 'cash')} onClick={() => set({ method: 'cash' })}>Cash</button>
      </div>
    </div>
  );
}
