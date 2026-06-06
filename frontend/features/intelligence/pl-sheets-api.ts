import { api } from '@/lib/api';

// Editable P&L scenario sheets (Intelligence OS, Phase 3 / T13). SCENARIO
// OVERLAY ONLY — these are standalone planning grids; they never override the
// real actuals P&L or feed EBITDA/valuation. Cells are stored as integer PENCE
// keyed "<lineId>:<colId>"; the UI edits in whole pounds and converts here.
// Mutations require finance.edit (audited) server-side.

const PROXY = '/api/backend';

export type SheetType = 'scenario' | 'budget' | 'forecast';
export interface SheetCol { id: string; label: string }
export interface SheetLine { id: string; label: string; kind?: 'line' | 'subtotal' | 'total' | 'header' }
export type SheetCells = Record<string, number>; // "<lineId>:<colId>" -> pence

export interface PlSheetSummary {
  id: string;
  name: string;
  type: SheetType;
  updated_at: string;
}
export interface PlSheet extends PlSheetSummary {
  cols: SheetCol[];
  lines: SheetLine[];
  cells: SheetCells;
  created_at: string;
}
export interface PlSheetInput {
  name: string;
  type?: SheetType;
  cols?: SheetCol[];
  lines?: SheetLine[];
  cells?: SheetCells;
}

export const listPlSheets = () => api<PlSheetSummary[]>('/api/analytics/pl-sheets');
export const getPlSheet = (id: string) => api<PlSheet>(`/api/analytics/pl-sheets/${id}`);

export const createPlSheet = (input: PlSheetInput) =>
  api<PlSheet>('/api/analytics/pl-sheets', { method: 'POST', body: JSON.stringify(input) });

export const updatePlSheet = (id: string, input: Partial<PlSheetInput>) =>
  api<PlSheet>(`/api/analytics/pl-sheets/${id}`, { method: 'PUT', body: JSON.stringify(input) });

export const deletePlSheet = (id: string) =>
  api<void>(`/api/analytics/pl-sheets/${id}`, { method: 'DELETE' });

// CSV export streams text (not JSON) — fetch the proxy directly and download a
// blob. The httpOnly auth cookie is sent automatically by the same-origin proxy.
export async function downloadPlSheetCsv(id: string, name: string): Promise<void> {
  const res = await fetch(`${PROXY}/api/analytics/pl-sheets/${id}/csv`);
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'pl-sheet'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
