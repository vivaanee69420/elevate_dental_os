// Marketing route wiring: the permission key exists, the feature key exists,
// and Reception can never reach it (project rule 5 — Reception is CRM-only).
import { describe, it, expect } from 'vitest';
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');
const { FEATURE_CATALOG } = await import('../src/lib/features.js');
const marketingRouter = (await import('../src/routes/marketing.routes.js')).default;

describe('marketing gating', () => {
    it('registers a marketing.view permission', () => {
        expect(PERMISSION_CATALOG).toHaveProperty('marketing.view');
    });
    it('registers a marketing module feature defaulting ON with its nav section', () => {
        expect(FEATURE_CATALOG.marketing).toMatchObject({
            kind: 'module', default: true, navSection: 'Marketing',
        });
    });
    it('grants marketing.view to practice_manager but NEVER to reception', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['marketing.view']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['marketing.view']).toBeUndefined();
    });
    it('owner keeps everything, marketing included', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['marketing.view']).toBe(true);
    });
});

// Fix round 1: the route MUST be gated with requirePermission('marketing.view'),
// not requireRole('owner', 'practice_manager') — otherwise the permission key
// is decorative and the Team Permissions matrix toggle has zero effect.
// Rather than assert on middleware identity (auth.js attaches no structural
// hook to requireRole/requirePermission the way requireFeature attaches
// .featureKey), this drives the ACTUAL guard on the route with synthetic
// req/res objects and asserts on its behaviour — which is what would
// actually regress if someone swapped the gate back to requireRole.
function mockRes() {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

function performanceGuard() {
    const layer = marketingRouter.stack.find((l) => l.route?.path === '/performance');
    if (!layer) throw new Error('GET /performance route not found');
    // Everything before the final handler is a gate; the permission gate is
    // the only middleware on this route, so it is stack[0].
    return layer.route.stack[0].handle;
}

describe('marketing route guard is permission-based, not role-based', () => {
    it('denies a practice_manager with no marketing.view permission (role alone must not grant access)', () => {
        const guard = performanceGuard();
        const req = { user: { role: 'practice_manager', permissions: {} } };
        const res = mockRes();
        let nextCalled = false;
        guard(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
    });
    it('grants a reception user that DOES carry marketing.view (permission, not role, decides)', () => {
        // This can never happen via DEFAULT_ROLE_PERMISSIONS (reception never
        // gets the key) but an owner override in the Team Permissions matrix
        // must still work — proving the gate reads req.user.permissions.
        const guard = performanceGuard();
        const req = { user: { role: 'reception', permissions: { 'marketing.view': true } } };
        const res = mockRes();
        let nextCalled = false;
        guard(req, res, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
    });
});
