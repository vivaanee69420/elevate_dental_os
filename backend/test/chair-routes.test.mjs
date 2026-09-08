// Chair routes and the write gate: which gate each route carries, and where
// the organisation comes from.
//
// The gates are asserted by RUNNING them. requirePermission and requireRole
// both return anonymous closures, so a name check cannot tell them apart --
// which is exactly how a route ends up silently carrying the wrong one.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/chair-utilisation.service.js', () => ({
    chairUtilisationService: {
        week: vi.fn(async () => ({ chairs: [], slots: [], weekByChair: {}, coverage: {} })),
        saveWeek: vi.fn(async () => ({ saved: 0 })),
        listChairs: vi.fn(async () => ({ chairs: [] })),
        createChair: vi.fn(async () => ({ id: 'c1' })),
        updateChair: vi.fn(async () => ({ id: 'c1' })),
        removeChair: vi.fn(async () => ({ ok: true })),
        listOpeningHours: vi.fn(async () => ({ days: [] })),
        saveOpeningHours: vi.fn(async () => ({ days: [] })),
        list: vi.fn(async () => []),
        grid: vi.fn(async () => ({})),
    },
}));

const { chairUtilisationService } = await import('../src/services/chair-utilisation.service.js');
const { chairUtilisationController } = await import('../src/controllers/chair-utilisation.controller.js');
const router = (await import('../src/routes/chair-utilisation.routes.js')).default;
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');
const { requirePermissionOrAgencyActor } = await import('../src/middleware/agency.js');

const layersFor = (method, path) => router.stack
    .filter((l) => l.route && l.route.path === path && l.route.methods[method])
    .flatMap((l) => l.route.stack.map((s) => s.handle));

const res = () => {
    const r = { json: vi.fn(() => r), status: vi.fn(() => r) };
    return r;
};

/** Run every gate on a route against a request, reporting whether all passed. */
async function passes(method, path, req) {
    const gates = layersFor(method, path).slice(0, -1); // all but the handler
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
        let allowed = false;
        await gate(req, { status: () => ({ json: () => {} }) }, () => { allowed = true; });
        if (!allowed) return false;
    }
    return true;
}

const owner = { user: { id: 'u1', organisation_id: 'org-a', role: 'owner', permissions: { 'operations.view': true, 'operations.edit': true } } };
const reception = { user: { id: 'u2', organisation_id: 'org-a', role: 'reception', permissions: { 'crm.view': true } } };
const viewer = { user: { id: 'u3', organisation_id: 'org-a', role: 'analyst', permissions: { 'operations.view': true } } };
const agency = { user: { id: 'u4', organisation_id: 'org-a', is_agency_admin: true, permissions: {} } };

beforeEach(() => vi.clearAllMocks());

describe('operations.edit catalog entry', () => {
    it('exists and is distinct from operations.view', () => {
        expect(PERMISSION_CATALOG['operations.edit']).toBeTruthy();
        expect(PERMISSION_CATALOG['operations.view']).toBeTruthy();
    });

    it('owner and practice manager hold it; reception does not (rule 5)', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['operations.edit']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['operations.edit']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['operations.edit']).toBeUndefined();
        expect(DEFAULT_ROLE_PERMISSIONS.analyst['operations.edit']).toBeUndefined();
    });
});

describe('requirePermissionOrAgencyActor', () => {
    const gate = requirePermissionOrAgencyActor('operations.edit');

    it('passes a tenant user holding the key', async () => {
        const next = vi.fn();
        await gate({ user: { permissions: { 'operations.edit': true } } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('passes an agency actor who does NOT hold the key', async () => {
        const next = vi.fn();
        await gate({ user: { is_agency_admin: true, permissions: {} } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('passes inside a validated switched agency context', async () => {
        const next = vi.fn();
        await gate({ agencyContext: { homeOrgId: 'org-agency' }, user: { permissions: {} } }, res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('rejects a reception user with 403 and does not call next', async () => {
        const next = vi.fn();
        const r = res();
        await gate({ user: { role: 'reception', permissions: { 'crm.view': true } } }, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('rejects an anonymous request', async () => {
        const next = vi.fn();
        const r = res();
        await gate({}, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('is NAMED, so a route test can tell it apart from another closure', () => {
        expect(gate.name).toBe('requirePermissionOrAgencyActor:operations.edit');
    });
});

describe('mounts', () => {
    it('exposes the week, chairs and opening-hours routes', () => {
        for (const [m, p] of [
            ['get', '/week'], ['put', '/week'],
            ['get', '/chairs'], ['post', '/chairs'],
            ['patch', '/chairs/:id'], ['delete', '/chairs/:id'],
            ['get', '/opening-hours'], ['put', '/opening-hours'],
        ]) {
            expect(layersFor(m, p), `${m} ${p}`).not.toHaveLength(0);
        }
    });

    it('the per-record write routes are GONE', () => {
        // They keyed a cell by free-text chair name and rewrote the whole
        // practice snapshot per cell.
        expect(layersFor('post', '/')).toHaveLength(0);
        expect(layersFor('patch', '/:id')).toHaveLength(0);
        expect(layersFor('delete', '/:id')).toHaveLength(0);
    });
});

describe('gates, actually run', () => {
    it('a viewer may read the week but NOT save it', async () => {
        expect(await passes('get', '/week', viewer)).toBe(true);
        expect(await passes('put', '/week', viewer)).toBe(false);
    });

    it('an owner may save the week, chairs and opening hours', async () => {
        expect(await passes('put', '/week', owner)).toBe(true);
        expect(await passes('post', '/chairs', owner)).toBe(true);
        expect(await passes('put', '/opening-hours', owner)).toBe(true);
    });

    it('an agency actor may save even without the tenant permission', async () => {
        expect(await passes('put', '/week', agency)).toBe(true);
    });

    it('reception is refused everywhere, read included (rule 5)', async () => {
        expect(await passes('get', '/week', reception)).toBe(false);
        expect(await passes('put', '/week', reception)).toBe(false);
        expect(await passes('delete', '/chairs/:id', reception)).toBe(false);
    });
});

describe('the organisation is never taken from the request', () => {
    it('saveWeek receives the session organisation, ignoring a body-supplied one', async () => {
        await expect(chairUtilisationController.saveWeek({
            user: { organisation_id: 'org-a' },
            body: {
                organisation_id: 'org-attacker',
                practice_id: '11111111-1111-1111-1111-111111111111',
                chair_id: '22222222-2222-2222-2222-222222222222',
                cells: [{ weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
            },
        }, res())).rejects.toThrow(); // .strict() rejects the stray key outright

        expect(chairUtilisationService.saveWeek).not.toHaveBeenCalled();
    });

    it('a clean body reaches the service under the SESSION organisation', async () => {
        await chairUtilisationController.saveWeek({
            user: { organisation_id: 'org-a' },
            body: {
                practice_id: '11111111-1111-1111-1111-111111111111',
                chair_id: '22222222-2222-2222-2222-222222222222',
                cells: [{ weekday: 1, slot: 'morning', booked_minutes: 60, revenue_pence: 0 }],
            },
        }, res());
        expect(chairUtilisationService.saveWeek).toHaveBeenCalledWith('org-a', expect.anything());
        expect(chairUtilisationService.saveWeek.mock.calls[0][1]).not.toHaveProperty('organisation_id');
    });

    it('a chair patch cannot rewrite organisation_id', async () => {
        await expect(chairUtilisationController.updateChair({
            user: { organisation_id: 'org-a' },
            params: { id: '33333333-3333-3333-3333-333333333333' },
            body: { name: 'Surgery 2', organisation_id: 'org-attacker' },
        }, res())).rejects.toThrow();
        expect(chairUtilisationService.updateChair).not.toHaveBeenCalled();
    });
});
