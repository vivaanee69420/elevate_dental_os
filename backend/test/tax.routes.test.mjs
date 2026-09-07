// ============================================================================
// Tax routes — the gates are RUN, not name-checked.
//
// requirePermission and requireRole both return anonymous closures, so
// inspecting the middleware tells you nothing about which one is mounted. The
// only way to know Reception cannot read a tax position, and that a practice
// manager with finance access cannot change the entity type, is to invoke the
// gate with that role and watch what it does.
//
// The org is the other half of the security story: it must always come from
// the authenticated session and never from the request, or one sub-account
// could read another's tax position by passing an id.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/tax.service.js', () => ({
    taxService: {
        overview: vi.fn(async () => ({ state: 'ok' })),
        settings: vi.fn(async () => ({ entity_type: 'limited_company' })),
        saveSettings: vi.fn(async () => ({ entity_type: 'limited_company' })),
        treatments: vi.fn(async () => ({ treatments: [] })),
        setLiability: vi.fn(async () => ({ ok: true })),
    },
}));

const { taxService } = await import('../src/services/tax.service.js');
const { DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');

// Resolve permissions the way authenticate() does, from the role's real
// defaults. An empty permissions object would deny EVERY role, so the
// "reception is refused" test below would pass without proving anything —
// the same shape of false pass the monthly_financials paging tests had.
const perms = (role, extra = {}) => ({ ...DEFAULT_ROLE_PERMISSIONS[role], ...extra });
const router = (await import('../src/routes/tax.routes.js')).default;

const layersFor = (method, path) => router.stack
    .filter((l) => l.route && l.route.path === path && l.route.methods[method])
    .flatMap((l) => l.route.stack.map((s) => s.handle));

const req = (over = {}) => ({
    user: { id: 'u1', organisation_id: 'org-a', role: 'owner', permissions: perms('owner') },
    params: {}, body: {}, query: {}, ...over,
});
const res = () => { const r = { json: vi.fn(), status: vi.fn(() => r) }; return r; };

// Run every middleware in the chain except the final handler, and report
// whether the request was allowed through.
async function passesGates(method, path, reqObj) {
    const layers = layersFor(method, path);
    const gates = layers.slice(0, -1);
    for (const gate of gates) {
        let blocked = false;
        let nextErr = null;
        const next = (err) => { if (err) { blocked = true; nextErr = err; } };
        const r = res();
        r.status = vi.fn(() => { blocked = true; return r; });
        try {
            await gate(reqObj, r, next);
        } catch (e) {
            blocked = true; nextErr = e;
        }
        if (blocked) return { allowed: false, error: nextErr };
    }
    return { allowed: true };
}

beforeEach(() => vi.clearAllMocks());

describe('tax routes', () => {
    // Guards against the whole file passing vacuously: if the owner fixture
    // carried no permissions, every refusal below would be meaningless.
    it('the owner fixture actually carries finance.view', () => {
        expect(perms('owner')['finance.view']).toBe(true);
        expect(perms('reception')['finance.view']).not.toBe(true);
    });

    it('mounts the five routes', () => {
        expect(layersFor('get', '/overview')).not.toHaveLength(0);
        expect(layersFor('get', '/settings')).not.toHaveLength(0);
        expect(layersFor('put', '/settings')).not.toHaveLength(0);
        expect(layersFor('get', '/treatments')).not.toHaveLength(0);
        expect(layersFor('put', '/treatments/liability')).not.toHaveLength(0);
    });

    // Rule 5: Reception is CRM only and must never see a tax position.
    it('refuses a reception user on every read', async () => {
        for (const path of ['/overview', '/settings', '/treatments']) {
            const r = await passesGates('get', path, req({
                user: { id: 'u2', organisation_id: 'org-a', role: 'reception', permissions: perms('reception') },
            }));
            expect(r.allowed, `reception must not read ${path}`).toBe(false);
        }
    });

    it('lets an owner read and write', async () => {
        expect((await passesGates('get', '/overview', req())).allowed).toBe(true);
        expect((await passesGates('put', '/settings', req())).allowed).toBe(true);
        expect((await passesGates('put', '/treatments/liability', req())).allowed).toBe(true);
    });

    // A practice manager with finance access can SEE the tax position but must
    // not be able to declare what regime the company is in, or reclassify a
    // treatment's VAT liability. Those are owner decisions with real
    // consequence, which is why the writes carry a different gate from the
    // reads rather than sharing one.
    it('lets a finance-enabled practice manager read but not write', async () => {
        const pm = () => req({
            user: {
                id: 'u3', organisation_id: 'org-a', role: 'practice_manager',
                permissions: perms('practice_manager', { 'finance.view': true }),
            },
        });
        expect((await passesGates('get', '/overview', pm())).allowed).toBe(true);
        expect((await passesGates('put', '/settings', pm())).allowed).toBe(false);
        expect((await passesGates('put', '/treatments/liability', pm())).allowed).toBe(false);
    });

    // The organisation is never a parameter. A body or query that names another
    // org must be ignored entirely.
    it('takes the organisation from the session, never the request', async () => {
        const { taxController } = await import('../src/controllers/tax.controller.js');
        await taxController.overview(
            req({ query: { organisation_id: 'org-b' }, body: { organisation_id: 'org-b' } }),
            res(),
        );
        expect(taxService.overview).toHaveBeenCalledWith('org-a', expect.any(Object));

        await taxController.saveSettings(
            req({ body: { organisation_id: 'org-b', entity_type: 'sole_trader' } }),
            res(),
        );
        const [org, patch] = taxService.saveSettings.mock.calls[0];
        expect(org).toBe('org-a');
        expect(patch).not.toHaveProperty('organisation_id');
    });
});
