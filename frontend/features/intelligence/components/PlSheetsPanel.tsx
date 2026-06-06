'use client';

// Editable P&L scenario sheets (Intelligence OS, Phase 3 / T13). A standalone
// planning grid that lives BESIDE the real P&L & Margin screen — it never
// overrides actuals or feeds EBITDA/valuation (scenario overlay, TODO1). Lines
// x columns of editable £ cells, Postgres-backed (NOT localStorage), with CSV
// export. Mutations require finance.edit server-side; a 403 surfaces on Save.

import { useEffect, useMemo, useState } from 'react';
import { PageHeader, EmptyState, AlertRow } from '@/components/ui';
import {
  usePlSheets,
  usePlSheet,
  useCreatePlSheet,
  useUpdatePlSheet,
  useDeletePlSheet,
} from '../pl-sheets-hooks';
import { downloadPlSheetCsv, type SheetCol, type SheetLine, type SheetCells } from '../pl-sheets-api';

const BRAND = 'var(--brand)';
const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`).slice(0, 8);

// A sensible starter grid for a new sheet: three months x a basic P&L skeleton.
function scaffold() {
  const cols: SheetCol[] = [
    { id: uid(), label: 'Month 1' },
    { id: uid(), label: 'Month 2' },
    { id: uid(), label: 'Month 3' },
  ];
  const lines: SheetLine[] = [
    { id: uid(), label: 'Revenue', kind: 'line' },
    { id: uid(), label: 'Staff', kind: 'line' },
    { id: uid(), label: 'Lab & materials', kind: 'line' },
    { id: uid(), label: 'Other overheads', kind: 'line' },
    { id: uid(), label: 'Net profit', kind: 'total' },
  ];
  return { cols, lines, cells: {} as SheetCells };
}

interface Draft {
  name: string;
  cols: SheetCol[];
  lines: SheetLine[];
  cells: SheetCells;
}

export function PlSheetsPanel() {
  const { data: sheets, isLoading } = usePlSheets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: sheet } = usePlSheet(selectedId);

  const create = useCreatePlSheet();
  const update = useUpdatePlSheet();
  const remove = useDeletePlSheet();

  const [draft, setDraft] = useState<Draft | null>(null);

  // Auto-select the first sheet once the list loads.
  useEffect(() => {
    if (!selectedId && sheets && sheets.length) setSelectedId(sheets[0].id);
  }, [sheets, selectedId]);

  // Seed the editable draft whenever the open sheet changes.
  useEffect(() => {
    if (sheet) setDraft({ name: sheet.name, cols: sheet.cols ?? [], lines: sheet.lines ?? [], cells: sheet.cells ?? {} });
  }, [sheet]);

  const newSheet = async () => {
    const s = scaffold();
    const created = await create.mutateAsync({ name: 'Untitled scenario', type: 'scenario', ...s });
    setSelectedId(created.id);
  };

  const cellKey = (lineId: string, colId: string) => `${lineId}:${colId}`;
  const setCell = (lineId: string, colId: string, raw: string) =>
    setDraft((d) => {
      if (!d) return d;
      const cells = { ...d.cells };
      const k = cellKey(lineId, colId);
      if (raw === '' || raw === '-') delete cells[k];
      else cells[k] = Math.round(Number(raw) * 100); // £ -> pence
      return { ...d, cells };
    });

  const addLine = () =>
    setDraft((d) => (d ? { ...d, lines: [...d.lines, { id: uid(), label: 'New line', kind: 'line' }] } : d));
  const addCol = () =>
    setDraft((d) => (d ? { ...d, cols: [...d.cols, { id: uid(), label: `Column ${d.cols.length + 1}` }] } : d));
  const delLine = (id: string) =>
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.id !== id) } : d));
  const delCol = (id: string) =>
    setDraft((d) => (d ? { ...d, cols: d.cols.filter((c) => c.id !== id) } : d));

  const save = () => {
    if (selectedId && draft) update.mutate({ id: selectedId, input: draft });
  };

  const total = useMemo(() => {
    if (!draft) return 0;
    return draft.lines.reduce((s, ln) => {
      if (ln.kind !== 'line') return s;
      const rowSum = draft.cols.reduce((cs, c) => cs + (draft.cells[cellKey(ln.id, c.id)] || 0), 0);
      // Revenue adds, every other line subtracts (a rough net-profit indicator).
      return /revenue|income|fees|turnover/i.test(ln.label) ? s + rowSum : s - rowSum;
    }, 0);
  }, [draft]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Scenario sheets"
        subtitle="Editable what-if / budget P&L grids. These are planning sheets — they sit beside your real P&L and never change your actuals or valuation."
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(sheets ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className="rounded-xl px-3 py-2 text-[13px] font-semibold border"
            style={{
              borderColor: s.id === selectedId ? BRAND : 'var(--border)',
              color: s.id === selectedId ? BRAND : 'var(--ink-muted)',
              background: s.id === selectedId ? 'rgba(14,124,123,0.05)' : 'transparent',
            }}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={newSheet}
          disabled={create.isPending}
          className="rounded-xl px-3 py-2 text-[13px] font-semibold border border-dashed disabled:opacity-60"
          style={{ borderColor: BRAND, color: BRAND }}
        >
          {create.isPending ? 'Creating…' : '+ New sheet'}
        </button>
      </div>

      {isLoading && <EmptyState message="Loading scenario sheets…" />}
      {!isLoading && (sheets ?? []).length === 0 && (
        <EmptyState message="No scenario sheets yet — create one to model a budget or what-if P&L." />
      )}
      {create.isError && <AlertRow tone="bad" title="Couldn't create sheet" body="You may not have finance edit permission." />}

      {draft && selectedId && (
        <div className="card-padded flex flex-col gap-4">
          {/* Sheet toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              className="display text-lg border-b border-transparent focus:border-border bg-transparent px-1 py-1 min-w-[200px]"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted mr-1">
                {update.isError ? 'Save failed (edit permission?)' : update.isSuccess ? 'Saved.' : ''}
              </span>
              <button onClick={addCol} className="rounded-xl px-3 py-2 text-[12px] font-semibold border border-border">+ Column</button>
              <button onClick={addLine} className="rounded-xl px-3 py-2 text-[12px] font-semibold border border-border">+ Line</button>
              <button
                onClick={() => downloadPlSheetCsv(selectedId, draft.name)}
                className="rounded-xl px-3 py-2 text-[12px] font-semibold border border-border"
              >
                Export CSV
              </button>
              <button
                onClick={save}
                disabled={update.isPending}
                className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
                style={{ background: BRAND }}
              >
                {update.isPending ? 'Saving…' : 'Save sheet'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this scenario sheet?')) {
                    remove.mutate(selectedId);
                    setSelectedId(null);
                    setDraft(null);
                  }
                }}
                className="rounded-xl px-3 py-2 text-[12px] font-semibold border border-border text-danger"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b border-border min-w-[160px]">Line</th>
                  {draft.cols.map((c) => (
                    <th key={c.id} className="p-2 border-b border-border min-w-[120px]">
                      <div className="flex items-center gap-1">
                        <input
                          value={c.label}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, cols: d.cols.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) } : d,
                            )
                          }
                          className="w-full text-right text-[12px] font-semibold bg-transparent border-b border-transparent focus:border-border px-1"
                        />
                        <button onClick={() => delCol(c.id)} className="text-ink-soft hover:text-danger text-xs" title="Remove column">×</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((ln) => (
                  <tr key={ln.id} className={ln.kind === 'total' ? 'font-semibold' : ''}>
                    <td className="p-2 border-b border-border">
                      <div className="flex items-center gap-1">
                        <input
                          value={ln.label}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, lines: d.lines.map((x) => (x.id === ln.id ? { ...x, label: e.target.value } : x)) } : d,
                            )
                          }
                          className="w-full bg-transparent border-b border-transparent focus:border-border px-1"
                        />
                        <button onClick={() => delLine(ln.id)} className="text-ink-soft hover:text-danger text-xs" title="Remove line">×</button>
                      </div>
                    </td>
                    {draft.cols.map((c) => {
                      const v = draft.cells[cellKey(ln.id, c.id)];
                      return (
                        <td key={c.id} className="p-1 border-b border-border">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={v == null ? '' : v / 100}
                            onChange={(e) => setCell(ln.id, c.id, e.target.value)}
                            className="w-full text-right bg-transparent px-2 py-1 rounded-lg focus:bg-[rgba(14,124,123,0.04)]"
                            placeholder="—"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-ink-soft">
            Indicative net (revenue lines minus all others):{' '}
            <strong style={{ color: total >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              £{(total / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}
            </strong>
            . Cells are whole pounds; saved to your organisation (not this browser).
          </p>
        </div>
      )}
    </div>
  );
}

export default PlSheetsPanel;
