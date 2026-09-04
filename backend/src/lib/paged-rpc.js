// ============================================================================
// Paged reads for set-returning RPCs.
//
// WHY. PostgREST exposes a set-returning function as a relation, so its result
// is subject to the SAME 1000-row cap as a table read. An RPC that returns one
// row per day, or per practice x treatment, therefore starts silently dropping
// rows the moment a tenant crosses that line — and the caller cannot tell,
// because a capped read looks exactly like a complete one.
//
// This is not theoretical and it is not distant. On the live org today:
//   settled_receipts_by_day   947 rows, growing ~81 per 90 days -> caps in ~2mo
//   treatment_revenue_matrix  901 rows, growing with each new treatment name
// Both feed the Turnover and Takings figures. Left alone, those numbers would
// have started drifting downward on their own, with nothing to point at.
//
// STOPPING RULE. Stop on a SHORT page, and additionally on an empty one. A
// short page cannot be followed by more rows under a stable ordering, and the
// empty-page check covers the exact-multiple boundary. Both are bounded by
// maxPages so a caller can never spin.
//
// THE LOOP BOUND IS LOAD-BEARING. The vitest harness lets a provider ignore
// `mods.range` and return the same fixed array forever; without a hard cap a
// paged reader does not fail cleanly, it hangs and then exhausts memory. A
// stubbed test that trips the bound should fail loudly instead.
// ============================================================================

export const RPC_PAGE_SIZE = 1000;
// 250k rows. Far beyond any legitimate result here, and low enough that a
// mis-stubbed test dies fast instead of eating the machine.
export const RPC_MAX_PAGES = 250;

// Read every row of a TABLE select, paging past the same cap.
//
// `build()` must return a FRESH query builder each call: a Supabase builder
// accumulates its modifiers, so reusing one instance sends two .order()/.range()
// clauses. `orderBy` must be a column with a total order (an id, not a
// timestamp) — OFFSET paging without one repeats or skips rows between pages.
//
// Same stopping rule and same loop bound as fetchAllRpc, for the same reasons.
export async function fetchAllRows(build, { orderBy = 'id', ascending = true, pageSize = RPC_PAGE_SIZE, maxPages = RPC_MAX_PAGES } = {}) {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
        const from = page * pageSize;
        const { data, error } = await build()
            .order(orderBy, { ascending })
            .range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        const rows = Array.isArray(data) ? data : [];
        out.push(...rows);
        if (rows.length < pageSize) return { data: out, error: null };
    }
    return {
        data: null,
        error: { message: `paged select exceeded ${maxPages} pages (${maxPages * pageSize} rows); refusing to return a partial result` },
    };
}

// Read every row of a set-returning RPC, paging past the row cap.
//
// `orderBy` is REQUIRED in spirit even where the function already sorts:
// paging without a total order can repeat or skip rows between pages. Pass the
// column the function orders by, or a unique-enough key.
export async function fetchAllRpc(client, fn, params, { orderBy = null, ascending = true, pageSize = RPC_PAGE_SIZE, maxPages = RPC_MAX_PAGES } = {}) {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
        let q = client.rpc(fn, params);
        if (orderBy) q = q.order(orderBy, { ascending });
        const from = page * pageSize;
        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        const rows = Array.isArray(data) ? data : [];
        out.push(...rows);
        // Short page => no more rows. Empty page covers the exact-multiple case.
        if (rows.length < pageSize) return { data: out, error: null };
    }
    // Hit the bound. Report it rather than returning a silently partial result —
    // a truncated total presented as complete is the failure being prevented.
    return {
        data: null,
        error: { message: `rpc ${fn} exceeded ${maxPages} pages (${maxPages * pageSize} rows); refusing to return a partial result` },
    };
}
