// ============================================================================
// Analyst API lock. The `analyst` role holds only `data.export` and must be
// confined to the Data Room SERVER-SIDE — several legacy feature routers under
// /api carry no requirePermission gate, so nav hiding alone is not a boundary.
// Mounted on the /api router immediately after authenticate (before audit).
//
// Allowed for analysts (path is relative to the /api mount):
//   any method   /data-room/*
//   GET          /practices*        (practice pills in the Data Room)
//   GET          /notifications*    (topbar bell)
// Everything else -> 403. Other roles are untouched.
// ============================================================================
const ALLOW = [
    { prefix: '/data-room' },
    { prefix: '/practices', methods: ['GET', 'HEAD'] },
    { prefix: '/notifications', methods: ['GET', 'HEAD'] },
];

function allowed(method, path) {
    return ALLOW.some((r) =>
        (path === r.prefix || path.startsWith(r.prefix + '/') || path.startsWith(r.prefix + '?')) &&
        (!r.methods || r.methods.includes(method)));
}

export function analystLock(req, res, next) {
    if (req.user?.role !== 'analyst') return next();
    // req.path is relative to the router mount (/api) and excludes the query string.
    if (allowed(req.method, req.path)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
}

export const __test = { allowed };
