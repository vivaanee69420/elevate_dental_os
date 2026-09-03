// CallRail provider — key verification, plus the provider-level status/sync/
// disconnect service + controller functions Task 3 owns. Every credential
// lives on an integration_accounts row (Task 4); this suite only proves what
// Task 3 built: verify() against CallRail's own account endpoint, that a
// never-connected org reads connected:false without throwing, that the org
// id is taken from the session (never a query/body param), and that
// disconnecting one org never touches another's row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        getByProvider: vi.fn().mockResolvedValue(null),
        markRevoked: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: {
        list: vi.fn().mockResolvedValue([]),
        markRevoked: vi.fn().mockResolvedValue(undefined),
    },
}));
// Task 4's call-side repository. Stubbed here because this suite is about the
// SESSION ORG ID, not about counting calls: callrailStatus fans out to it, and
// sourceBreakdown now goes through the RPC callrail_source_breakdown, which the
// shared Supabase mock refuses unless explicitly stubbed. Task 4's own suite
// covers what these return.
vi.mock('../src/repositories/callrail.repository.js', () => ({
    callrailRepository: {
        sourceBreakdown: vi.fn().mockResolvedValue([]),
        callCountsByAccount: vi.fn().mockResolvedValue([]),
        upsertCalls: vi.fn().mockResolvedValue(0),
        restampPractice: vi.fn().mockResolvedValue(0),
    },
}));

import { integrationRepository } from '../src/repositories/integration.repository.js';
import { integrationAccountRepository } from '../src/repositories/integration-account.repository.js';
import { callrailProvider } from '../src/lib/integrations/callrail-provider.js';
import { integrationService } from '../src/services/integration.service.js';
import { integrationController } from '../src/controllers/integration.controller.js';

function mockRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    integrationRepository.getByProvider.mockResolvedValue(null);
    integrationAccountRepository.list.mockResolvedValue([]);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('callrailProvider.verify', () => {
    it('accepts a good key and returns the account name', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ id: 'ACT1', name: 'Ashford Dental' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const name = await callrailProvider.verify('key-good', 'ACT1');
        expect(name).toBe('Ashford Dental');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.callrail.com/v3/a/ACT1.json');
        expect(opts.headers.Authorization).toBe('Token token="key-good"');
    });

    it('rejects a 401 with a message that never contains the key', async () => {
        const secretKey = 'sk-super-secret-do-not-leak-777';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

        await expect(callrailProvider.verify(secretKey, 'ACT1')).rejects.toThrow();

        let caught = null;
        try {
            await callrailProvider.verify(secretKey, 'ACT1');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toContain(secretKey);
    });

    it('rejects a 403 with a message that never contains the key', async () => {
        const secretKey = 'another-secret-key-99';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));

        let caught = null;
        try {
            await callrailProvider.verify(secretKey, 'ACT1');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toContain(secretKey);
    });

    it('throws without an API key, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.verify('', 'ACT1')).rejects.toThrow(/API key/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws without an account id, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.verify('key-good', '')).rejects.toThrow(/account/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a network failure surfaces a generic message, never the raw error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        await expect(callrailProvider.verify('key-good', 'ACT1')).rejects.toThrow(/Could not reach CallRail/i);
    });
});

describe('integrationService.callrailStatus', () => {
    it('returns connected:false with empty arrays for an org with no connection, without throwing', async () => {
        integrationRepository.getByProvider.mockResolvedValueOnce(null);
        const status = await integrationService.callrailStatus('org-no-conn');
        expect(status).toEqual({ connected: false, accounts: [], sourceBreakdown: [] });
    });

    it('reads the marker row for the exact org id passed in', async () => {
        await integrationService.callrailStatus('org-xyz');
        expect(integrationRepository.getByProvider).toHaveBeenCalledWith('org-xyz', 'callrail');
    });

    it('reports connected:true once the marker row is active', async () => {
        integrationRepository.getByProvider.mockResolvedValueOnce({ status: 'active' });
        const status = await integrationService.callrailStatus('org-connected');
        expect(status.connected).toBe(true);
    });
});

describe('integrationController.callrailGet — org id comes from the session', () => {
    it('uses req.user.organisation_id, ignoring any org id on the query or body', async () => {
        const res = mockRes();
        await integrationController.callrailGet(
            {
                user: { organisation_id: 'org-real' },
                query: { organisation_id: 'org-spoofed' },
                body: { organisation_id: 'org-spoofed-2' },
            },
            res,
        );
        expect(integrationRepository.getByProvider).toHaveBeenCalledWith('org-real', 'callrail');
        expect(integrationRepository.getByProvider).not.toHaveBeenCalledWith('org-spoofed', 'callrail');
        expect(res.json).toHaveBeenCalledWith({ connected: false, accounts: [], sourceBreakdown: [] });
    });
});

describe('integrationService.callrailSync', () => {
    it('returns { ingested: 0 } without throwing when there is nothing to sync yet (no companies)', async () => {
        const result = await integrationService.callrailSync('org-1');
        expect(result).toEqual({ ingested: 0, accounts: 0, results: [] });
    });
});

describe('integrationService.callrailDisconnect', () => {
    it('marks the marker row and every company beneath it revoked, and returns connected:false', async () => {
        integrationAccountRepository.list.mockResolvedValueOnce([{ id: 'acc-1' }, { id: 'acc-2' }]);
        const result = await integrationService.callrailDisconnect('org-A');
        expect(result).toEqual({ connected: false });
        expect(integrationAccountRepository.markRevoked).toHaveBeenCalledWith('org-A', 'acc-1');
        expect(integrationAccountRepository.markRevoked).toHaveBeenCalledWith('org-A', 'acc-2');
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-A', 'callrail');
    });

    it('is safe to call for an org that was never connected', async () => {
        integrationAccountRepository.list.mockResolvedValueOnce([]);
        const result = await integrationService.callrailDisconnect('org-never-connected');
        expect(result).toEqual({ connected: false });
        expect(integrationAccountRepository.markRevoked).not.toHaveBeenCalled();
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-never-connected', 'callrail');
    });

    it("a second org's connection is untouched by the first org's disconnect", async () => {
        integrationAccountRepository.list.mockImplementation(async (orgId) =>
            orgId === 'org-A' ? [{ id: 'acc-A1' }] : [{ id: 'acc-B1' }],
        );

        await integrationService.callrailDisconnect('org-A');

        expect(integrationAccountRepository.list).toHaveBeenCalledWith('org-A', 'callrail');
        expect(integrationAccountRepository.markRevoked).toHaveBeenCalledWith('org-A', 'acc-A1');
        // Org B's account id and org id never appear in any call this made.
        expect(integrationAccountRepository.markRevoked).not.toHaveBeenCalledWith('org-B', expect.anything());
        expect(integrationAccountRepository.markRevoked).not.toHaveBeenCalledWith(expect.anything(), 'acc-B1');
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-A', 'callrail');
        expect(integrationRepository.markRevoked).not.toHaveBeenCalledWith('org-B', 'callrail');
    });
});

describe('integrationController.callrailDisconnect — org id comes from the session', () => {
    it('uses req.user.organisation_id, ignoring any org id on the query or body', async () => {
        const res = mockRes();
        await integrationController.callrailDisconnect(
            {
                user: { organisation_id: 'org-real' },
                query: { organisation_id: 'org-spoofed' },
                body: { organisation_id: 'org-spoofed-2' },
            },
            res,
        );
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-real', 'callrail');
        expect(integrationRepository.markRevoked).not.toHaveBeenCalledWith('org-spoofed', 'callrail');
        expect(res.json).toHaveBeenCalledWith({ connected: false });
    });
});
