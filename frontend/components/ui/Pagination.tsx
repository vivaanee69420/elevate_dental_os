'use client';

// Pagination — numbered page links with Previous / Next, a rows-per-page
// selector and a "Showing a–b of N" summary. Presentational: the caller owns
// the page/pageSize state (the Data Room keeps them in the URL).

export const DEFAULT_PAGE_SIZES = [25, 50, 100, 250];

/**
 * Page numbers to render for `page` of `pageCount`: always 1 and the last
 * page, `siblings` either side of the current page, and a 'gap' where pages
 * are skipped (a single skipped page is shown rather than replaced by '…').
 */
export function pageItems(page: number, pageCount: number, siblings = 2): (number | 'gap')[] {
  const last = Math.max(1, pageCount);
  const cur = Math.min(Math.max(1, page), last);
  const wanted = new Set<number>([1, last]);
  for (let p = cur - siblings; p <= cur + siblings; p++) if (p >= 1 && p <= last) wanted.add(p);
  const sorted = Array.from(wanted).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev === 2) out.push(prev + 1);
    else if (prev && p - prev > 2) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

const btn =
  'min-w-[36px] h-9 px-2.5 rounded-lg border text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const idle = 'bg-card text-ink border-border hover:border-brand-200';
const activeCls = 'bg-brand text-white border-brand font-medium shadow-panel-sm';

export function Pagination({
  page,
  pageSize,
  total,
  pageSizes = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  isFetching = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isFetching?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  const fmt = (n: number) => n.toLocaleString('en-GB');

  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={`${btn} ${idle}`}
          onClick={() => onPageChange(cur - 1)}
          disabled={cur <= 1 || isFetching}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        {pageItems(cur, pageCount).map((item, i) =>
          item === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-ink-muted select-none" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`${btn} ${item === cur ? activeCls : idle}`}
              onClick={() => onPageChange(item)}
              disabled={isFetching && item !== cur}
              aria-current={item === cur ? 'page' : undefined}
              aria-label={`Page ${item}`}
            >
              {fmt(item)}
            </button>
          ),
        )}
        <button
          type="button"
          className={`${btn} ${idle}`}
          onClick={() => onPageChange(cur + 1)}
          disabled={cur >= pageCount || isFetching}
          aria-label="Next page"
        >
          Next ›
        </button>
      </div>

      <span className="text-[13px] text-ink-muted">
        {total === 0 ? 'No rows' : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
        {' · '}Page {fmt(cur)} of {fmt(pageCount)}
      </span>

      <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-muted">
        Rows per page
        <select
          className="text-[13px] border border-border bg-card text-ink px-2.5 py-1.5 rounded-lg shadow-panel-sm cursor-pointer"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
