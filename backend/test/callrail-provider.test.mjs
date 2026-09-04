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
// SESSION ORG ID, not about counting calls: callrailService.status fans out to it, and
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

// CallRail's hierarchy is Account -> Company -> Calls: verify() now proves a
// key against a SPECIFIC COMPANY under a SPECIFIC ACCOUNT
// (GET /v3/a/{accountId}/companies/{companyId}.json), not the account alone
// — the earlier account-only check is exactly what let a pasted account id
// pass verification while a genuine company id 404'd.
describe('callrailProvider.verify', () => {
    it('accepts a good key and returns the company name', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ id: 'COM1', name: 'Ashford Dental' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const name = await callrailProvider.verify('key-good', 'ACC1', 'COM1');
        expect(name).toBe('Ashford Dental');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.callrail.com/v3/a/ACC1/companies/COM1.json');
        expect(opts.headers.Authorization).toBe('Token token="key-good"');
    });

    it('rejects a 401 with a message that never contains the key', async () => {
        const secretKey = 'sk-super-secret-do-not-leak-777';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

        await expect(callrailProvider.verify(secretKey, 'ACC1', 'COM1')).rejects.toThrow();

        let caught = null;
        try {
            await callrailProvider.verify(secretKey, 'ACC1', 'COM1');
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
            await callrailProvider.verify(secretKey, 'ACC1', 'COM1');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toContain(secretKey);
    });

    it('rejects a 404 (e.g. a valid account id but a company id that does not belong to it)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
        await expect(callrailProvider.verify('key-good', 'ACC1', 'COM-nope')).rejects.toThrow(/company/i);
    });

    it('throws without an API key, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.verify('', 'ACC1', 'COM1')).rejects.toThrow(/API key/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws without an account id, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.verify('key-good', '', 'COM1')).rejects.toThrow(/account/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws without a company id, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.verify('key-good', 'ACC1', '')).rejects.toThrow(/company/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a network failure surfaces a generic message, never the raw error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        await expect(callrailProvider.verify('key-good', 'ACC1', 'COM1')).rejects.toThrow(/Could not reach CallRail/i);
    });
});

// A single-page-of-data + one-empty-page-to-confirm-done response sequence —
// the shape every successful listAccounts/listCompanies call makes under the
// "stop on an empty page, never a short one" discipline (see
// callrail-provider.js's fetchAllPages). Two requests for one page of real
// data, always.
function pageThenDone(items) {
    return vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => (items) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) });
}

describe('callrailProvider.listCompanies', () => {
    it('lists every company under an account, from a bare-array response, paging until an EMPTY page — not a short one', async () => {
        const fetchMock = pageThenDone([{ id: 'COM1', name: 'Ashford' }, { id: 'COM2', name: 'Bexleyheath' }]);
        vi.stubGlobal('fetch', fetchMock);

        const companies = await callrailProvider.listCompanies('key-good', 'ACC1');
        expect(companies).toEqual([{ id: 'COM1', name: 'Ashford' }, { id: 'COM2', name: 'Bexleyheath' }]);

        // REQUEST COUNT, not just the row total: one page of data + one empty
        // page confirming there is no more — never stops on the first (full)
        // page alone.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [firstUrl] = fetchMock.mock.calls[0];
        expect(String(firstUrl)).toBe('https://api.callrail.com/v3/a/ACC1/companies.json?page=1&per_page=100');
        const [secondUrl] = fetchMock.mock.calls[1];
        expect(String(secondUrl)).toBe('https://api.callrail.com/v3/a/ACC1/companies.json?page=2&per_page=100');
    });

    it('follows real multi-page pagination: page 1 full, page 2 partial, page 3 empty — 3 requests, not 2', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 'COM1', name: 'A' }, { id: 'COM2', name: 'B' }]) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 'COM3', name: 'C' }]) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) });
        vi.stubGlobal('fetch', fetchMock);

        const companies = await callrailProvider.listCompanies('key-good', 'ACC1');
        expect(companies.map((c) => c.id)).toEqual(['COM1', 'COM2', 'COM3']);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('tolerates a { companies: [...] } wrapper shape', async () => {
        vi.stubGlobal('fetch', pageThenDone({ companies: [{ id: 'COM1', name: 'Ashford' }] }));
        const companies = await callrailProvider.listCompanies('key-good', 'ACC1');
        expect(companies).toEqual([{ id: 'COM1', name: 'Ashford' }]);
    });

    it('a company with no name falls back to its id, never dropped', async () => {
        vi.stubGlobal('fetch', pageThenDone([{ id: 'COM1', name: '' }]));
        const companies = await callrailProvider.listCompanies('key-good', 'ACC1');
        expect(companies).toEqual([{ id: 'COM1', name: 'COM1' }]);
    });

    it('rejects a 401 with a message that never contains the key, after exactly ONE request (no pagination past a failure)', async () => {
        const secretKey = 'sk-do-not-leak';
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchMock);
        let caught = null;
        try {
            await callrailProvider.listCompanies(secretKey, 'ACC1');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toContain(secretKey);
        expect(caught.callrailStatus).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a 404 (account not found) distinctly from a 401', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
        await expect(callrailProvider.listCompanies('key-good', 'ACC-nope')).rejects.toThrow(/account ACC-nope was not found/i);
    });

    it('throws without an API key, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.listCompanies('', 'ACC1')).rejects.toThrow(/API key/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('callrailProvider.listAccounts — the key-only discovery step', () => {
    it('lists every account a key can see, from GET /v3/a.json, paging until an EMPTY page', async () => {
        const fetchMock = pageThenDone([
            { id: 'ACC1', name: 'Last Mile Metrics' },
            { id: 'ACC2', name: 'Second Practice Group' },
        ]);
        vi.stubGlobal('fetch', fetchMock);

        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts).toEqual([
            { id: 'ACC1', name: 'Last Mile Metrics' },
            { id: 'ACC2', name: 'Second Practice Group' },
        ]);

        // REQUEST COUNT: one page of data + one empty page confirming done.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [firstUrl, opts] = fetchMock.mock.calls[0];
        expect(String(firstUrl)).toBe('https://api.callrail.com/v3/a.json?page=1&per_page=100');
        expect(opts.headers.Authorization).toBe('Token token="key-good"');
        const [secondUrl] = fetchMock.mock.calls[1];
        expect(String(secondUrl)).toBe('https://api.callrail.com/v3/a.json?page=2&per_page=100');
    });

    it('follows real multi-page pagination across accounts: 2 full pages + 1 empty page = 3 requests', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 'ACC1', name: 'A' }, { id: 'ACC2', name: 'B' }]) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 'ACC3', name: 'C' }, { id: 'ACC4', name: 'D' }]) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) });
        vi.stubGlobal('fetch', fetchMock);

        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts.map((a) => a.id)).toEqual(['ACC1', 'ACC2', 'ACC3', 'ACC4']);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('an account with no name falls back to its id, never dropped', async () => {
        vi.stubGlobal('fetch', pageThenDone([{ id: 'ACC1', name: '' }]));
        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts).toEqual([{ id: 'ACC1', name: 'ACC1' }]);
    });

    it('an empty key never can see zero accounts is still a VALID (not thrown) empty result — a truly empty first page', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }));
        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts).toEqual([]);
    });

    it('rejects a 401 with a message that never contains the key, and stamps callrailStatus for the caller to distinguish auth from an outage', async () => {
        const secretKey = 'sk-super-secret-do-not-leak';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
        let caught = null;
        try {
            await callrailProvider.listAccounts(secretKey);
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toContain(secretKey);
        expect(caught.message).toMatch(/rejected this API key/i);
        expect(caught.callrailStatus).toBe(401);
    });

    it('a 5xx is reported distinctly from an auth failure (no "rejected this API key" wording) and still stamps callrailStatus', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
        let caught = null;
        try {
            await callrailProvider.listAccounts('key-good');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).not.toMatch(/rejected this API key/i);
        expect(caught.callrailStatus).toBe(503);
    });

    it('a network failure surfaces a generic message, never the raw error, and carries no callrailStatus', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        let caught = null;
        try {
            await callrailProvider.listAccounts('key-good');
        } catch (err) {
            caught = err;
        }
        expect(caught).not.toBeNull();
        expect(caught.message).toMatch(/Could not reach CallRail/i);
        expect(caught.callrailStatus).toBeUndefined();
    });

    it('throws without an API key, and never calls CallRail', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callrailProvider.listAccounts('')).rejects.toThrow(/API key/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

// The 429-backoff loop callrail-sync.js's calls.json pull used to carry its
// own copy of — now ONE shared implementation (fetchWithBackoff), exercised
// here through listAccounts so a discovery-path retry is proven without a
// second bespoke retry test harness. test/setup.js sets
// CALLRAIL_RETRY_BASE_MS=1 so this does not sleep through real backoff.
describe('callrailProvider — shared 429 backoff (fetchWithBackoff)', () => {
    it('retries a 429 and succeeds on the next attempt, honouring no Retry-After header', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null } })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 'ACC1', name: 'Ashford' }]) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) });
        vi.stubGlobal('fetch', fetchMock);

        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts).toEqual([{ id: 'ACC1', name: 'Ashford' }]);
        expect(fetchMock).toHaveBeenCalledTimes(3); // 429, retry (success), empty page
    });

    it('honours a positive Retry-After header when CallRail sends one, rather than the base backoff', async () => {
        // A tiny-but-positive value so this takes the Retry-After branch
        // (retryAfter > 0) instead of the base-backoff fallback, without
        // slowing the suite down.
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '0.001' : null) } })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) });
        vi.stubGlobal('fetch', fetchMock);

        const accounts = await callrailProvider.listAccounts('key-good');
        expect(accounts).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after exhausting retries on a persistent 429', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } }));
        await expect(callrailProvider.listAccounts('key-good')).rejects.toThrow(/exhausted 429 retries/i);
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
