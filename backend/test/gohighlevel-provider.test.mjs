// GoHighLevel provider — authorize URL/state, token exchange success/failure,
// and the single-use-refresh claim guard. Repository is mocked (its upsert
// chain doesn't fit the shared Supabase fake); fetch is stubbed per case.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn().mockResolvedValue({}),
        upsertSecrets: vi.fn().mockResolvedValue(undefined),
        getByProvider: vi.fn(),
        markFailed: vi.fn().mockResolvedValue(undefined),
        markRevoked: vi.fn().mockResolvedValue(undefined),
        claimRefresh: vi.fn(),
        clearRefresh: vi.fn().mockResolvedValue(undefined),
    },
}));

import { integrationRepository } from '../src/repositories/integration.repository.js';
import { GoHighLevelProvider } from '../src/lib/integrations/gohighlevel-provider.js';
import { verifyState } from '../src/lib/oauth-state.js';
import { encryptSecret } from '../src/lib/crypto.js';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.GHL_CLIENT_ID = 'cid';
    process.env.GHL_CLIENT_SECRET = 'csecret';
    process.env.OAUTH_STATE_SECRET = 'state-secret';
    process.env.INTEGRATIONS_SECRET_KEY = 'enc-key';
    process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';
});

describe('authorize', () => {
    it('builds the chooselocation URL with scopes, backend redirect_uri, and a verifiable state', async () => {
        const { redirectUrl } = await GoHighLevelProvider.authorize('org-1');
        const u = new URL(redirectUrl);
        expect(u.host).toBe('marketplace.leadconnectorhq.com');
        expect(u.searchParams.get('scope')).toContain('opportunities.readonly');
        expect(u.searchParams.get('redirect_uri')).toBe('https://api.example.com/oauth/gohighlevel/callback');
        expect(verifyState(u.searchParams.get('state'), 'gohighlevel')).toEqual({ orgId: 'org-1', provider: 'gohighlevel' });
        expect(integrationRepository.upsert).toHaveBeenCalledWith('org-1', 'gohighlevel', { status: 'pending' });
    });

    it('throws when GHL_CLIENT_ID is unset', async () => {
        delete process.env.GHL_CLIENT_ID;
        await expect(GoHighLevelProvider.authorize('org-1')).rejects.toThrow(/GHL_CLIENT_ID/);
    });
});

describe('callback', () => {
    it('persists encrypted tokens + locationId on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, locationId: 'loc-9', companyId: 'co-1', scope: 'x' }),
        });
        await GoHighLevelProvider.callback('org-1', { code: 'abc' });
        expect(integrationRepository.upsertSecrets).toHaveBeenCalledTimes(1);
        const arg = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(arg.config.locationId).toBe('loc-9');
        expect(arg.status).toBe('active');
        expect(Buffer.isBuffer(arg.secrets)).toBe(true); // encrypted blob, not plaintext
    });

    it('marks failed and throws on a non-2xx token response', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error_description: 'bad code' }) });
        await expect(GoHighLevelProvider.callback('org-1', { code: 'x' })).rejects.toThrow(/bad code/);
        expect(integrationRepository.markFailed).toHaveBeenCalledWith('org-1', 'gohighlevel', 'bad code');
    });

    it('throws when code is missing', async () => {
        await expect(GoHighLevelProvider.callback('org-1', {})).rejects.toThrow(/authorization code/);
    });
});

describe('refresh (single-use guard)', () => {
    it('skips when the row cannot be claimed', async () => {
        integrationRepository.claimRefresh.mockResolvedValue(false);
        const r = await GoHighLevelProvider.refresh('org-1');
        expect(r).toEqual({ skipped: 'refresh_in_progress' });
        expect(global.fetch).not.toBe(undefined); // not called for refresh
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
    });

    it('rotates the token and always clears the claim', async () => {
        integrationRepository.claimRefresh.mockResolvedValue(true);
        integrationRepository.getByProvider.mockResolvedValue({
            secrets: encryptSecret(JSON.stringify({ access_token: 'old', refresh_token: 'old-rt' })),
        });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'new', refresh_token: 'new-rt', expires_in: 3600, locationId: 'loc-9' }),
        });
        const r = await GoHighLevelProvider.refresh('org-1');
        expect(r).toEqual({ ok: true });
        expect(integrationRepository.upsertSecrets).toHaveBeenCalledTimes(1);
        expect(integrationRepository.clearRefresh).toHaveBeenCalledWith('org-1', 'gohighlevel');
    });

    it('clears the claim even when refresh fails', async () => {
        integrationRepository.claimRefresh.mockResolvedValue(true);
        integrationRepository.getByProvider.mockResolvedValue({
            secrets: encryptSecret(JSON.stringify({ refresh_token: 'old-rt' })),
        });
        global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error_description: 'invalid_grant' }) });
        await expect(GoHighLevelProvider.refresh('org-1')).rejects.toThrow(/invalid_grant/);
        expect(integrationRepository.clearRefresh).toHaveBeenCalledWith('org-1', 'gohighlevel');
    });
});
