// ============================================================================
// Keyset pager for PostgREST table reads.
//
// PostgREST silently truncates a select at 1000 rows -- no error, no flag, just
// fewer rows. An in-Node aggregate over a truncated read reports a confidently
// wrong total, which is a failure this codebase has already shipped once (see
// the monthly_financials truncation).
//
// Two rules, both load-bearing:
//   1. Page on a UNIQUE key, so no row is skipped or repeated across pages.
//   2. Stop on an EMPTY page, never a short one. A short page is not proof of
//      the end; treating it as one silently truncates.
//
// Keyset, not OFFSET: OFFSET makes the server re-walk every skipped row, which
// made a whole-org map build quadratic in row count here before.
// ============================================================================

const DEFAULT_PAGE_SIZE = 1000;

// A runaway guard, not a limit anyone should reach: 1000 pages is a million
// rows. It exists because "stop on an empty page" trusts the source to
// eventually return one. A source that ignores the cursor -- a proxy that
// drops query parameters, or a test double serving a fixed array -- would
// otherwise spin for ever, hanging the request with no error to read. Failing
// loudly on page 1001 beats hanging silently.
const MAX_PAGES = 1000;

/**
 * @param buildQuery () => PostgrestFilterBuilder — called fresh per page, so
 *        each page gets its own builder rather than mutating a shared one.
 */
export async function pageAll(buildQuery, { cursorCol = 'id', pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        let query = buildQuery().order(cursorCol, { ascending: true }).limit(pageSize);
        if (cursor != null) query = query.gt(cursorCol, cursor);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) return out;
        out.push(...data);
        const next = data[data.length - 1][cursorCol];
        // Without a moving cursor the next page repeats this one for ever.
        if (next == null) {
            throw new Error(`pageAll: cursor column "${cursorCol}" is null; cannot page safely`);
        }
        cursor = next;
    }
    throw new Error(`pageAll: exceeded ${MAX_PAGES} pages — the cursor is not advancing`);
}
