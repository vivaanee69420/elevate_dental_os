// Pure P&L matrix helpers for /profit. Input: FinanceMonth[] in POUNDS, ascending
// by 'YYYY-MM'. Output: line-item rows × time-period columns, QuickBooks-style.
// No I/O, no Date.now — callers pass the report window. Money is whole pounds.
import type { FinanceMonth } from './api';

export type GroupBy = 'total' | 'month' | 'quarter' | 'year';

// The fixed P&L line items (order = render order). 'profit' and 'margin' are
// derived rows rendered after the cost lines.
export const PL_LINES = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'associate_pay', label: 'Associate pay' },
  { key: 'staff_costs', label: 'Staff' },
  { key: 'lab_materials', label: 'Lab/materials' },
  { key: 'opex', label: 'OpEx' },
] as const;

export type LineKey = (typeof PL_LINES)[number]['key'];

export interface MatrixColumn {
  key: string;          // stable id, e.g. '2026-01', '2026-Q1', '2026', 'total'
  label: string;        // display, e.g. 'Jan 2026', 'Q1 2026', '2026', 'Total'
  values: Record<LineKey, number>;
  profit: number;
  marginPct: number | null; // null when revenue is 0
  costsAvailable: boolean;  // any month in the column had real costs
}

const ZERO = (): Record<LineKey, number> => ({
  revenue: 0, associate_pay: 0, staff_costs: 0, lab_materials: 0, opex: 0,
});

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Which column a month falls into, for a given grouping.
function columnIdFor(month: string, groupBy: GroupBy): { key: string; label: string } {
  const [y, m] = month.split('-').map(Number);
  if (groupBy === 'total') return { key: 'total', label: 'Total' };
  if (groupBy === 'year') return { key: `${y}`, label: `${y}` };
  if (groupBy === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  return { key: month, label: `${MONTH_NAMES[m - 1]} ${y}` };
}

function emptyColumn(key: string, label: string): MatrixColumn {
  return { key, label, values: ZERO(), profit: 0, marginPct: null, costsAvailable: false };
}

function addMonth(col: MatrixColumn, mo: FinanceMonth): void {
  col.values.revenue += mo.revenue;
  col.values.associate_pay += mo.associate_pay;
  col.values.staff_costs += mo.staff_costs;
  col.values.lab_materials += mo.lab_materials;
  col.values.opex += mo.opex;
  col.profit += mo.profit;
  if (mo.costsAvailable) col.costsAvailable = true;
}

function finaliseMargin(col: MatrixColumn): MatrixColumn {
  col.marginPct = col.values.revenue > 0
    ? (col.profit / col.values.revenue) * 100
    : null;
  return col;
}

// Pivot months -> ordered columns. Months must already be sliced to the report
// window by the caller. Column order follows first appearance (ascending months).
export function buildColumns(months: FinanceMonth[], groupBy: GroupBy): MatrixColumn[] {
  const order: string[] = [];
  const byId = new Map<string, MatrixColumn>();
  for (const mo of months) {
    const { key, label } = columnIdFor(mo.month, groupBy);
    let col = byId.get(key);
    if (!col) { col = emptyColumn(key, label); byId.set(key, col); order.push(key); }
    addMonth(col, mo);
  }
  return order.map((k) => finaliseMargin(byId.get(k)!));
}

// Sum a window of months into a single column with the given label (used for
// previous-period / previous-year comparison totals).
export function totalColumn(months: FinanceMonth[], key: string, label: string): MatrixColumn {
  const col = emptyColumn(key, label);
  for (const mo of months) addMonth(col, mo);
  return finaliseMargin(col);
}

// Each line as % of the column's revenue. Returns null entries when revenue is 0.
export function pctOfIncome(col: MatrixColumn): Record<LineKey, number | null> {
  const rev = col.values.revenue;
  const out = {} as Record<LineKey, number | null>;
  for (const { key } of PL_LINES) {
    out[key] = rev > 0 ? (col.values[key] / rev) * 100 : null;
  }
  return out;
}

// Slice an ascending month array to [fromYM, toYM] inclusive (YYYY-MM compare).
export function sliceMonths(months: FinanceMonth[], fromYM: string | null, toYM: string | null): FinanceMonth[] {
  return months.filter((m) => (!fromYM || m.month >= fromYM) && (!toYM || m.month <= toYM));
}

// Shift a 'YYYY-MM' key by N months (N may be negative).
export function shiftYM(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}
