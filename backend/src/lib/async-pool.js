// ============================================================================
// Run async tasks with a bounded concurrency, preserving result order.
//
// Promise.all over a large fan-out of DB queries is actively counter-
// productive against a small Postgres: the Business Hub fired 16 heavy
// aggregates at once, and the resulting self-contention pushed individual
// statements past the 8s statement_timeout — panels failed while their
// neighbours on the same page succeeded. A modest limit finishes the whole
// batch SOONER as well as more reliably, because each query gets a fair share
// instead of all 16 thrashing.
// ============================================================================

export async function mapWithConcurrency(tasks, limit = 4) {
    const results = new Array(tasks.length);
    if (tasks.length === 0) return results;
    let next = 0;
    const worker = async () => {
        for (;;) {
            const i = next++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    };
    // Rejects on the first failing task, matching Promise.all's contract.
    await Promise.all(
        Array.from({ length: Math.min(limit, tasks.length) }, worker),
    );
    return results;
}
