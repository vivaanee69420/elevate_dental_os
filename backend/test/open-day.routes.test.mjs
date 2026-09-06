// ============================================================================
// Open-day routes — the gates, and where the org comes from.
//
// These are the one mapping mutations in this codebase that are NOT
// requireAgencyActor-gated: open days are the tenant's own events, so a tenant
// owner records them. That makes the two properties below the whole security
// story for this feature — writes are owner-only, and the organisation is
// always taken from the authenticated session, never from the request.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/open-day.service.js', () => ({
    openDayService: {
        list: vi.fn(async () => ({ openDays: [], campaigns: [] })),
        create: vi.fn(async () => ({ id: 'e1' })),
        update: vi.fn(async () => ({ ok: true })),
        remove: vi.fn(async () => ({ ok: true })),
        setCampaigns: vi.fn(async () => ({ mapped: 0 })),
        setCampaign: vi.fn(async () => ({ ok: true })),
        setPipeline: vi.fn(async () => ({ ok: true })),
    },
}));

const { openDayService } = await import('../src/services/open-day.service.js');
const { openDayController } = await import('../src/controllers/open-day.controller.js');
const router = (await import('../src/routes/marketing.routes.js')).default;
const { requireRole } = await import('../src/middleware/auth.js');

const layersFor = (method, path) => router.stack
    .filter((l) => l.route && l.route.path === path && l.route.methods[method])
    .flatMap((l) => l.route.stack.map((s) => s.handle));

const req = (over = {}) => ({
    user: { id: 'u1', organisation_id: 'org-a', role: 'owner' },
    params: {}, body: {}, query: {}, ...over,
});
const res = () => { const r = { json: vi.fn(), status: vi.fn(() => r) }; return r; };

beforeEach(() => vi.clearAllMocks());

describe('open-day routes', () => {
    it('mounts read and write routes under the Facebook report', () => {
        expect(layersFor('get', '/facebook/open-days')).not.toHaveLength(0);
        expect(layersFor('post', '/facebook/open-days')).not.toHaveLength(0);
        expect(layersFor('patch', '/facebook/open-days/:id')).not.toHaveLength(0);
        expect(layersFor('delete', '/facebook/open-days/:id')).not.toHaveLength(0);
        expect(layersFor('put', '/facebook/open-days/:id/campaigns')).not.toHaveLength(0);
        expect(layersFor('put', '/facebook/open-days/campaigns')).not.toHaveLength(0);
        expect(layersFor('put', '/facebook/open-days/pipelines')).not.toHaveLength(0);
    });

    // A practice manager reading the report must see the events behind its
    // numbers; only an owner may change what those numbers mean.
    //
    // Asserted by RUNNING the gate, not by inspecting it: requireRole and
    // requirePermission both return anonymous closures, so their names are
    // both '' and a structural check cannot tell a gate from a controller —
    // or one gate from the other.
    const runGate = (handler, user) => new Promise((resolve) => {
        const res = {
            statusCode: null,
            status(code) { this.statusCode = code; return this; },
            json() { resolve({ blocked: true, status: this.statusCode }); return this; },
        };
        handler({ user, params: {}, body: {}, query: {} }, res, () => resolve({ blocked: false }));
    });

    const PM = { id: 'u2', organisation_id: 'org-a', role: 'practice_manager', permissions: { 'marketing.view': true } };
    const OWNER = { id: 'u1', organisation_id: 'org-a', role: 'owner', permissions: { 'marketing.view': true } };

    it('refuses a practice manager on every write', async () => {
        for (const [m, p] of [
            ['post', '/facebook/open-days'],
            ['patch', '/facebook/open-days/:id'],
            ['delete', '/facebook/open-days/:id'],
            ['put', '/facebook/open-days/:id/campaigns'],
            ['put', '/facebook/open-days/campaigns'],
            // requireOwnerOrAgencyActor, not requireRole('owner') like the
            // rest — but a plain practice manager (no is_agency_admin) is
            // neither an owner nor an agency actor, so it still belongs here.
            ['put', '/facebook/open-days/pipelines'],
        ]) {
            const gate = layersFor(m, p)[0];
            await expect(runGate(gate, PM), `${m} ${p}`).resolves.toMatchObject({ blocked: true, status: 403 });
            await expect(runGate(gate, OWNER), `${m} ${p}`).resolves.toMatchObject({ blocked: false });
        }
    });

    it('lets a practice manager READ the events behind the report', async () => {
        const gate = layersFor('get', '/facebook/open-days')[0];
        await expect(runGate(gate, PM)).resolves.toMatchObject({ blocked: false });
    });

    it('refuses a reader without marketing.view, so Reception stays out', async () => {
        const gate = layersFor('get', '/facebook/open-days')[0];
        const reception = { id: 'u3', organisation_id: 'org-a', role: 'reception', permissions: { 'crm.view': true } };
        await expect(runGate(gate, reception)).resolves.toMatchObject({ blocked: true, status: 403 });
    });

    it('takes the organisation from the session, never from the body or query', async () => {
        const r = res();
        await openDayController.create(
            req({ body: { name: 'July 26', organisation_id: 'org-somebody-else' } }), r,
        );
        expect(openDayService.create).toHaveBeenCalledWith('org-a', expect.objectContaining({ name: 'July 26' }));
        const [, payload] = openDayService.create.mock.calls[0];
        expect(payload).not.toHaveProperty('organisation_id');
    });

    it('passes the path id and the session org to a rename', async () => {
        await openDayController.update(req({ params: { id: 'e1' }, body: { name: 'Renamed' } }), res());
        expect(openDayService.update).toHaveBeenCalledWith('org-a', 'e1', expect.objectContaining({ name: 'Renamed' }));
    });

    it('rejects a campaign list that is not a list, rather than writing nothing quietly', async () => {
        const next = vi.fn();
        await openDayController.setCampaigns(
            req({ params: { id: 'e1' }, body: { campaigns: 'c1' } }), res(), next,
        );
        expect(next).toHaveBeenCalled();
        expect(openDayService.setCampaigns).not.toHaveBeenCalled();
    });

    it('takes the organisation from the session, never the body, when mapping a pipeline', async () => {
        const r = res();
        await openDayController.setPipeline(
            req({
                body: {
                    integrationAccountId: '11111111-1111-1111-1111-111111111111',
                    ghlPipelineId: 'g1',
                    openDayId: '22222222-2222-2222-2222-222222222222',
                    organisation_id: 'org-somebody-else',
                },
            }),
            r,
        );
        expect(openDayService.setPipeline).toHaveBeenCalledWith('org-a', expect.objectContaining({
            integrationAccountId: '11111111-1111-1111-1111-111111111111',
        }));
        const [, payload] = openDayService.setPipeline.mock.calls[0];
        expect(payload).not.toHaveProperty('organisation_id');
    });
});

describe('pipeline mapping gate', () => {
    it('lets a tenant owner map a pipeline, and an agency actor who is not an owner', async () => {
        const { requireOwnerOrAgencyActor } = await import('../src/middleware/agency.js');
        const run = (user) => new Promise((resolve) => {
            const res = { status() { return this; }, json() { resolve({ blocked: true }); return this; } };
            requireOwnerOrAgencyActor({ user }, res, () => resolve({ blocked: false }));
        });
        await expect(run({ role: 'owner', organisation_id: 'o' })).resolves.toMatchObject({ blocked: false });
        await expect(run({ role: 'practice_manager', organisation_id: 'o', is_agency_admin: true }))
            .resolves.toMatchObject({ blocked: false });
        await expect(run({ role: 'practice_manager', organisation_id: 'o' }))
            .resolves.toMatchObject({ blocked: true });
    });
});
