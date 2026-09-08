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

/**
 * @param buildQuery () => PostgrestFilterBuilder — called fresh per page, so
 *        each page gets its own builder rather than mutating a shared one.
 */
export async function pageAll(buildQuery, { cursorCol = 'id', pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const out = [];
    let cursor = null;
    for (;;) {
        let query = buildQuery().order(cursorCol, { ascending: true }).limit(pageSize);
        if (cursor != null) query = query.gt(cursorCol, cursor);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        out.push(...data);
        cursor = data[data.length - 1][cursorCol];
    }
    return out;
}
