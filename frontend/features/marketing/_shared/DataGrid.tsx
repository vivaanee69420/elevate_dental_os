'use client';
// ============================================================================
// The table shell the ad reports use. Replaces AdMetricTable, which is left in
// place for the Facebook tabs that still call it.
//
// WHAT CHANGED AND WHY, since "it looks nicer" is not a reason anyone can
// check later:
//
//  * NO OUTER BOX. AdMetricTable wrapped every table in a rounded, bordered,
//    filled panel and gave the header row its own grey fill. Stacked with the
//    page's other panels that produces the boxes-inside-boxes look of a
//    template. A table is already a grid; it does not need a frame to be
//    read. What it needs is a rule under the header and hairlines between
//    rows, which is what this does.
//
//  * HEADERS AS LABELS, NOT BUTTONS-THAT-LOOK-LIKE-CELLS. 10.5px, uppercase,
//    letter-spaced, muted. They recede, and the numbers — the actual content —
//    come forward. This one change does more for the page than any other here.
//
//  * SORTING, because a metric table without it is an argument you cannot
//    check. Click a header to sort; the indicator appears only on the active
//    column, so nothing shouts at rest.
//
//  * A SECOND LINE PER CELL. Every column may render `sub`, shown small and
//    muted beneath the value. That is what lets one column carry both a
//    figure and its context (an ad group under an ad's name, a cost per
//    conversion under a spend) instead of the table growing another column
//    that nobody reads.
//
//  * EXPANDABLE ROWS. `renderExpanded` opens a panel underneath the row, in
//    place. This exists specifically because Google's hierarchy forks — an ad
//    group has BOTH ads and keywords under it — so a click that navigated to
//    one of them had to pick arbitrarily, which is exactly the behaviour that
//    prompted this rewrite. Expanding shows both, and leaves the reader where
//    they were.
//
// The em-dash contract still lives in ./format.ts and is applied by the
// caller's render functions, not here: this component lays out a grid and
// takes no view on what a null means.
// ============================================================================
import { Fragment, useMemo, useState, type ReactNode } from 'react';

export type GridColumn<R> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  /** The cell's main content. */
  render: (row: R) => ReactNode;
  /** Optional second line, small and muted, under the main content. */
  sub?: (row: R) => ReactNode;
  /** Return a comparable value to make this column sortable. Omit for
   *  columns that have no meaningful order (a bar, a set of chips). */
  sortBy?: (row: R) => number | string | null;
  /** Column width hint, e.g. 'w-28'. */
  width?: string;
};

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

// Nulls sort LAST in both directions, always.
//
// They are not small numbers — a null cost-per-lead means "no leads", not
// "free" — so letting them fall to the top of an ascending sort would put the
// rows with no information where the reader looks first. This is the table
// equivalent of the em-dash rule in ./format.ts.
function compare(a: number | string | null, b: number | string | null, dir: 'asc' | 'desc') {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const cmp = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'en-GB');
  return dir === 'asc' ? cmp : -cmp;
}

export function DataGrid<R>({
  columns,
  rows,
  rowKey,
  emptyState,
  defaultSort,
  renderExpanded,
  onRowClick,
  rowTone,
}: {
  columns: GridColumn<R>[];
  rows: R[];
  /** A stable identity per row. Index is not enough once rows re-sort. */
  rowKey: (row: R, index: number) => string;
  emptyState: ReactNode;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** When given, every row becomes expandable and this renders the panel. */
  renderExpanded?: (row: R) => ReactNode;
  /** Navigate on click instead of expanding. Mutually exclusive with
   *  renderExpanded in practice — a row that both expands AND navigates gives
   *  the reader no way to predict what a click does, which is the exact
   *  complaint that started this rewrite. */
  onRowClick?: (row: R) => void;
  /** 'muted' greys a row back — used for the "Not attributed" bucket, which
   *  belongs in the table but is not a campaign competing in it. */
  rowTone?: (row: R) => 'default' | 'muted';
}) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortBy) return rows;
    // Copy before sorting: `rows` is the query cache's own array.
    return [...rows].sort((a, b) => compare(col.sortBy!(a), col.sortBy!(b), sort.dir));
  }, [rows, sort, columns]);

  if (rows.length === 0) return <>{emptyState}</>;

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key
      // Third click clears the sort and restores the server's own order,
      // which for these tables is spend-descending and is frequently the
      // order the reader wants back.
      ? (s.dir === 'desc' ? { key, dir: 'asc' } : null)
      : { key, dir: 'desc' }));
  };

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] border-separate border-spacing-0">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const sortable = Boolean(c.sortBy);
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface px-3 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } ${c.width ?? ''}`}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-[0.07em] transition-colors hover:text-ink ${
                        active ? 'text-ink' : ''
                      }`}
                    >
                      {c.header}
                      {/* The indicator exists only on the active column. A
                          permanent pair of faint arrows on every header is
                          visual noise on a table with twelve of them. */}
                      {active && <span aria-hidden>{sort!.dir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {(renderExpanded || onRowClick) && (
              <th className="sticky top-0 z-10 w-8 border-b border-border bg-surface" />
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const key = rowKey(row, i);
            const isOpen = open.has(key);
            const muted = rowTone?.(row) === 'muted';
            return (
              // Fragment with a key, not a bare <>: a row and its expansion
              // panel are two sibling <tr>s and React needs one key across
              // both, or reordering after a sort re-mounts every open panel.
              <Fragment key={key}>
                <tr
                  className={`group border-b border-border/70 transition-colors ${
                    renderExpanded || onRowClick ? 'cursor-pointer hover:bg-brand-50/40' : ''
                  } ${muted ? 'text-ink-muted' : ''}`}
                  onClick={(() => {
                    if (onRowClick) return () => onRowClick(row);
                    if (!renderExpanded) return undefined;
                    return () => setOpen((cur) => {
                      const next = new Set(cur);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    });
                  })()}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`border-b border-border/70 px-3 py-2.5 align-top text-[13px] ${
                        c.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                      } ${muted ? '' : 'text-ink'}`}
                    >
                      <div className="leading-tight">{c.render(row)}</div>
                      {c.sub && (
                        <div className="mt-0.5 text-[11px] leading-tight text-ink-muted">{c.sub(row)}</div>
                      )}
                    </td>
                  ))}
                  {(renderExpanded || onRowClick) && (
                    <td className="border-b border-border/70 px-2 py-2.5 align-top text-ink-muted">
                      {/* The affordance says which of the two things a click
                          does: a chevron that ROTATES opens in place, a
                          chevron that does not navigates. */}
                      <span
                        aria-hidden
                        className={`inline-block transition-transform group-hover:text-brand ${
                          renderExpanded && isOpen ? 'rotate-90' : ''
                        }`}
                      >
                        ›
                      </span>
                    </td>
                  )}
                </tr>
                {renderExpanded && isOpen && (
                  <tr>
                    <td colSpan={columns.length + 1} className="border-b border-border bg-bg/60 px-3 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
