// In-memory sync progress, keyed by org+provider. The on-demand sync runs in
// the web process and the UI polls GET /integrations/:provider/sync-progress
// from the same process, so a module-level Map is sufficient (no DB writes).
// Ephemeral by design — lost on restart, overwritten by the next sync.

const store = new Map();
const k = (orgId, provider) => `${orgId}:${provider}`;

export function setProgress(orgId, provider, patch) {
    const prev = store.get(k(orgId, provider)) || {};
    store.set(k(orgId, provider), { ...prev, ...patch, at: Date.now() });
}

export function getProgress(orgId, provider) {
    return store.get(k(orgId, provider)) || null;
}

export function clearProgress(orgId, provider) {
    store.delete(k(orgId, provider));
}
