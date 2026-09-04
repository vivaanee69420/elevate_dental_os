'use client';

// The table shell shared by all seven ad-reporting metric tables (Facebook's
// three tabs, Google's four). Its own `overflow-x-auto` container so a wide
// row of metric columns scrolls inside the card — the page body must never
// scroll horizontally — and a sticky header so a long table stays readable
// while scrolling. Cell formatting (the em-dash contract) lives in
// `./format.ts`, applied by the caller's `render` functions, not here — this
// component only lays the grid out.
//
// `emptyState` is caller-supplied rather than a built-in "No data" message
// because "no rows" means something different per tenant state (not
// connected / connected but never synced / connected but genuinely no spend
// in this window) — a generic empty table would make a broken tenant look
// identical to a quiet one.
import type { ReactNode } from 'react';

export type Column<R> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: R) => ReactNode;
};

export function AdMetricTable<R>({
  columns,
  rows,
  emptyState,
  onRowClick,
}: {
  columns: Column<R>[];
  rows: R[];
  emptyState: ReactNode;
  onRowClick?: (row: R) => void;
}) {
  if (rows.length === 0) return <>{emptyState}</>;

  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface">
      <table className="w-full text-[13.5px]">
        <thead className="bg-bg">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`sticky top-0 z-10 bg-bg px-4 py-3 font-medium text-ink-muted ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              // No stable row id in this generic contract (callers vary:
              // campaigns, ad sets, ads, keywords…) — the row's position is
              // the key, matching the `row-${i}` fallback already used in
              // the per-file tables this component replaces.
              key={i}
              className={`border-t border-border ${onRowClick ? 'cursor-pointer hover:bg-bg' : ''}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-ink ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
