// In-memory sync progress, keyed by org+provider. The on-demand sync runs in
// the web process and the UI polls GET /integrations/:provider/sync-progress
// from the same process, so a module-level Map is sufficient (no DB writes).
// Ephemeral by design — lost on restart, overwritten by the next sync.

const store = new Map();
const k = (orgId, provider) => `${orgId}:${provider}`;

// 'starting'/'idle' are transient status, not resources — keep them out of the
// per-phase breakdown so the UI lists only real pull phases.
const META_PHASES = new Set(['starting', 'idle']);

export function setProgress(orgId, provider, patch) {
    const prev = store.get(k(orgId, provider)) || {};
    const next = { ...prev, ...patch, at: Date.now() };
    // Accumulate a per-phase breakdown so the UI can show EACH resource's pull
    // (e.g. "Contacts 1,240 · Opportunities 2,639 99%") instead of only the
    // current phase. Keyed by phase, insertion order = pull order. Updated only
    // when a patch carries a phase (the heartbeat's empty patch leaves it alone);
    // missing fields fall back to the phase's last-seen value so a pct-only tick
    // (e.g. the link loop) never wipes the count established during the fetch.
    if (patch.phase && !META_PHASES.has(patch.phase)) {
        const phases = { ...(prev.phases || {}) };
        const cur = phases[patch.phase] || {};
        phases[patch.phase] = {
            phase: patch.phase,
            count: patch.count ?? cur.count ?? 0,
            pct: patch.pct ?? cur.pct ?? 0,
            page: patch.page ?? cur.page ?? 0,
            totalPages: patch.totalPages ?? cur.totalPages ?? null,
        };
        next.phases = phases;
    }
    // Pre-seed expected phases (in order, count 0) so the UI can list not-yet-
    // reached phases as "Waiting". Does NOT touch the active `phase`; only adds
    // entries that don't exist yet. The directive itself is not persisted.
    if (Array.isArray(patch.expectedPhases)) {
        const phases = { ...(next.phases || {}) };
        for (const ph of patch.expectedPhases) {
            if (!phases[ph]) phases[ph] = { phase: ph, count: 0, pct: 0, page: 0, totalPages: null };
        }
        next.phases = phases;
        delete next.expectedPhases;
    }
    store.set(k(orgId, provider), next);
}

export function getProgress(orgId, provider) {
    return store.get(k(orgId, provider)) || null;
}

export function clearProgress(orgId, provider) {
    store.delete(k(orgId, provider));
}
