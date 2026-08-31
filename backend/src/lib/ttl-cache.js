// ============================================================================
// Small in-process TTL cache with a bounded size.
//
// Used for expensive read-only aggregates (the Business Hub fan-out), which
// recompute the same numbers for every viewer of the same org+window. In
// process rather than Redis on purpose: no new infrastructure, and the hit
// rate that matters here is "the same user reloading / navigating within a
// minute". If the backend is ever scaled to several instances the only cost
// is a lower hit rate per instance — correctness is unaffected, because
// entries are pure derived data with a short TTL.
// ============================================================================

export function createTtlCache({ ttlMs, max = 200, now = Date.now } = {}) {
    const map = new Map(); // key -> { at, value } — Map preserves insertion order

    return {
        get(key) {
            const hit = map.get(key);
            if (!hit) return undefined;
            if (now() - hit.at > ttlMs) {
                map.delete(key);
                return undefined;
            }
            return hit.value;
        },

        set(key, value) {
            // Refresh position so the eviction below is oldest-first.
            if (map.has(key)) map.delete(key);
            else if (map.size >= max) map.delete(map.keys().next().value);
            map.set(key, { at: now(), value });
            return value;
        },

        // Drop every key starting with `prefix` (e.g. one org's entries after a
        // sync). No prefix clears everything.
        invalidate(prefix) {
            if (!prefix) return map.clear();
            for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k);
        },

        get size() { return map.size; },
    };
}
