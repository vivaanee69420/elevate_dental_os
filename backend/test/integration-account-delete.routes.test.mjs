// ============================================================================
// The permanent-delete routes — the gates, and where the PROVIDER comes from.
//
// One controller serves GoHighLevel, CallRail and QuickBooks, so the provider
// has to be bound by the route. If it were read from the request, a QuickBooks
// account id posted to the GoHighLevel path would delete a company's entire
// P&L (957 monthly_financials rows, 47 invoices and 18 bank accounts on the
// live org) through a panel that never mentions QuickBooks.
//
// Asserted by RUNNING the layers, not by reading them: requireRole returns an
// anonymous closure, and so does the provider binder, so a name check cannot
// tell one from the other or prove either is wired at all.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/integration-account-delete.service.js', () => ({
    deleteAccountPermanently: vi.fn(async () => ({ deleted: true, cascade: {}, detach: {} })),
}));

const { deleteAccountPermanently } = await import('../src/services/integration-account-delete.service.js');
const router = (await import('../src/routes/integrations.routes.js')).default;

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555';

const PATHS = {
    gohighlevel: '/gohighlevel/accounts/:id/permanent',
    callrail: '/callrail/accounts/:id/permanent',
    quickbooks: '/quickbooks/accounts/:id/permanent',
};

const layersFor = (method, path) => router.stack
    .filter((l) => l.route && l.route.path === path && l.route.methods[method])
    .flatMap((l) => l.route.stack.map((s) => s.handle));

const req = (over = {}) => ({
    user: { id: 'u1', organisation_id: 'org-a', role: 'owner' },
    params: { id: ACCOUNT_ID }, body: {}, query: {}, ...over,
});
const res = () => { const r = { json: vi.fn(), status: vi.fn(() => r) }; return r; };

// Run every layer in order, as Express would.
async function run(path, request) {
    const response = res();
    for (const layer of layersFor('delete', path)) {
        let advanced = false;
        // eslint-disable-next-line no-await-in-loop
        await layer(request, response, () => { advanced = true; });
        if (!advanced) break;
    }
    return response;
}

beforeEach(() => vi.clearAllMocks());

describe('permanent account deletion routes', () => {
    it('mounts one for every provider that keeps accounts in integration_accounts', () => {
        for (const path of Object.values(PATHS)) {
            expect(layersFor('delete', path)).not.toHaveLength(0);
        }
    });

    it('binds the provider from the ROUTE, so an id cannot be deleted through another provider\'s path', async () => {
        for (const [provider, path] of Object.entries(PATHS)) {
            vi.clearAllMocks();
            // A caller trying to smuggle a different provider in the request.
            await run(path, req({ query: {}, body: { provider: 'quickbooks' }, accountProvider: 'quickbooks' }));
            expect(deleteAccountPermanently).toHaveBeenCalledWith('org-a', ACCOUNT_ID, provider, { confirm: false });
        }
    });

    it('passes confirm through only when the caller asked for it', async () => {
        await run(PATHS.gohighlevel, req({ query: { confirm: 'true' } }));
        expect(deleteAccountPermanently).toHaveBeenCalledWith('org-a', ACCOUNT_ID, 'gohighlevel', { confirm: true });

        vi.clearAllMocks();
        // Anything that is not the literal string 'true' is not consent.
        await run(PATHS.gohighlevel, req({ query: { confirm: '1' } }));
        expect(deleteAccountPermanently).toHaveBeenCalledWith('org-a', ACCOUNT_ID, 'gohighlevel', { confirm: false });
    });

    it('is owner-only on every provider — a practice manager cannot delete an account', async () => {
        for (const path of Object.values(PATHS)) {
            vi.clearAllMocks();
            const response = await run(path, req({ user: { id: 'u2', organisation_id: 'org-a', role: 'practice_manager' } }));
            expect(deleteAccountPermanently).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(403);
        }
    });

    it('takes the organisation from the session, never from the request', async () => {
        await run(PATHS.callrail, req({ body: { organisation_id: 'org-victim' }, query: { organisationId: 'org-victim' } }));
        expect(deleteAccountPermanently).toHaveBeenCalledWith('org-a', ACCOUNT_ID, 'callrail', { confirm: false });
    });
});
