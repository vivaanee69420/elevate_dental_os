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

// The standard P&L skeleton every starter grid uses (revenue down to net).
const baseLines = (): SheetLine[] => [
  { id: uid(), label: 'Revenue', kind: 'line' },
  { id: uid(), label: 'Staff', kind: 'line' },
  { id: uid(), label: 'Lab & materials', kind: 'line' },
  { id: uid(), label: 'Other overheads', kind: 'line' },
  { id: uid(), label: 'Net profit', kind: 'total' },
];
const cols = (labels: string[]): SheetCol[] => labels.map((label) => ({ id: uid(), label }));

// A plain blank-ish starter: three months x the P&L skeleton.
function scaffold() {
  return { cols: cols(['Month 1', 'Month 2', 'Month 3']), lines: baseLines(), cells: {} as SheetCells };
}

// Quick-start templates surfaced on the empty state so a first sheet is one click
// away. Each just pre-shapes the grid (name + columns + the shared P&L skeleton);
// every cell stays empty for the owner to fill. Nothing here touches actuals.
const TEMPLATES: { key: string; name: string; desc: string; build: () => { cols: SheetCol[]; lines: SheetLine[]; cells: SheetCells } }[] = [
  {
    key: 'budget',
    name: 'Monthly budget',
    desc: 'Three months of revenue, staff, lab & overheads down to net profit.',
    build: () => ({ cols: cols(['Month 1', 'Month 2', 'Month 3']), lines: baseLines(), cells: {} }),
  },
  {
    key: 'whatif',
    name: 'What-if scenario',
    desc: 'A baseline beside a scenario — model a fee uplift, a new hire or a cost cut.',
    build: () => ({ cols: cols(['Baseline', 'Scenario']), lines: baseLines(), cells: {} }),
  },
  {
    key: 'annual',
    name: 'Annual plan',
    desc: 'Four quarters across the same P&L skeleton for a full-year view.',
    build: () => ({ cols: cols(['Q1', 'Q2', 'Q3', 'Q4']), lines: baseLines(), cells: {} }),
  },
];

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

  const newSheet = async (tpl?: (typeof TEMPLATES)[number]) => {
    const s = tpl ? tpl.build() : scaffold();
    const created = await create.mutateAsync({ name: tpl ? tpl.name : 'Untitled scenario', type: 'scenario', ...s });
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

      {(sheets ?? []).length > 0 && (
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
            onClick={() => newSheet()}
            disabled={create.isPending}
            className="rounded-xl px-3 py-2 text-[13px] font-semibold border border-dashed disabled:opacity-60"
            style={{ borderColor: BRAND, color: BRAND }}
          >
            {create.isPending ? 'Creating…' : '+ New sheet'}
          </button>
        </div>
      )}

      {isLoading && <EmptyState message="Loading scenario sheets…" />}
      {!isLoading && (sheets ?? []).length === 0 && (
        <div className="card-padded flex flex-col items-center text-center gap-6 py-12">
          {/* Spreadsheet glyph — no emoji (project rule 7). */}
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl"
            style={{ background: 'rgba(14,124,123,0.08)', color: BRAND }}
            aria-hidden
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
          </div>
          <div>
            <h3 className="display text-xl">Plan a budget or test a what-if</h3>
            <p className="text-[13px] text-ink-muted max-w-[480px] mt-1.5 leading-relaxed">
              A scenario sheet is an editable P&amp;L grid you fill in by hand. It sits beside your real numbers
              for planning — it never changes your actuals or your valuation. Pick a starting point:
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 w-full max-w-[680px]">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                onClick={() => newSheet(tpl)}
                disabled={create.isPending}
                className="group text-left rounded-2xl border border-border bg-card p-4 transition hover:shadow-panel-sm hover:border-[color:var(--brand)] disabled:opacity-60"
              >
                <div className="text-[13px] font-semibold text-ink">{tpl.name}</div>
                <div className="text-[12px] text-ink-muted mt-1 leading-relaxed">{tpl.desc}</div>
                <div className="text-[12px] font-semibold mt-3" style={{ color: BRAND }}>
                  {create.isPending ? 'Creating…' : 'Start →'}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => newSheet()}
            disabled={create.isPending}
            className="text-[12px] font-semibold text-ink-muted hover:text-ink underline underline-offset-4 disabled:opacity-60"
          >
            or start from a blank sheet
          </button>
        </div>
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
