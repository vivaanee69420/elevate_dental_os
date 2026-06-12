// GoHighLevel provider — OAuth2 marketplace flow (primary) + API-key broker
// fallback. Repository + global fetch are mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn().mockResolvedValue({}),
        upsertSecrets: vi.fn().mockResolvedValue(undefined),
        markRevoked: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
        getByProvider: vi.fn().mockResolvedValue(null),
        claimRefresh: vi.fn().mockResolvedValue(true),
        clearRefresh: vi.fn().mockResolvedValue(undefined),
    },
}));

import { integrationRepository } from '../src/repositories/integration.repository.js';
import { GoHighLevelProvider } from '../src/lib/integrations/gohighlevel-provider.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';

const OAUTH_ENV = {
    GHL_CLIENT_ID: 'client-123',
    GHL_CLIENT_SECRET: 'secret-456',
    BACKEND_PUBLIC_URL: 'https://api.example.com',
    OAUTH_STATE_SECRET: 'state-secret',
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTEGRATIONS_SECRET_KEY = 'enc-key';
});
afterEach(() => {
    for (const k of Object.keys(OAUTH_ENV)) delete process.env[k];
    vi.unstubAllGlobals();
});

describe('authorize — OAuth when configured', () => {
    it('returns a LeadConnector redirect URL with the leadconnector slug (no highlevel/ghl)', async () => {
        Object.assign(process.env, OAUTH_ENV);
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(res.redirectUrl).toBeTruthy();
        const u = new URL(res.redirectUrl);
        expect(u.searchParams.get('client_id')).toBe('client-123');
        expect(u.searchParams.get('redirect_uri')).toBe('https://api.example.com/oauth/leadconnector/callback');
        expect(u.searchParams.get('redirect_uri')).not.toMatch(/highlevel|ghl/i);
        expect(u.searchParams.get('response_type')).toBe('code');
        expect(u.searchParams.get('state')).toContain('.');
        expect(integrationRepository.upsert).toHaveBeenCalledWith('org-1', 'gohighlevel', { status: 'pending' });
    });
});

describe('authorize — broker fallback when OAuth not configured', () => {
    it('prompts for an API key + location id', async () => {
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(res).toMatchObject({ requiresKeyPaste: true, requiresLocationId: true });
        expect(res.pasteHint).toMatch(/API key/i);
    });
});

describe('callback — OAuth code exchange', () => {
    it('exchanges the code and persists tokens + locationId from GHL', async () => {
        Object.assign(process.env, OAUTH_ENV);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                access_token: 'at-1', refresh_token: 'rt-1', expires_in: 86399,
                scope: 'contacts.readonly opportunities.readonly', locationId: 'loc-9', companyId: 'co-1',
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });
        expect(res).toMatchObject({ ok: true, locationId: 'loc-9' });

        // Token endpoint hit with form-urlencoded grant_type + matching redirect_uri.
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('https://services.leadconnectorhq.com/oauth/token');
        expect(opts.body).toContain('grant_type=authorization_code');
        expect(opts.body).toContain('user_type=Location');
        expect(opts.body).toContain(encodeURIComponent('https://api.example.com/oauth/leadconnector/callback'));

        const arg = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(arg.config.locationId).toBe('loc-9');
        expect(arg.status).toBe('active');
        expect(arg.expires_at).toBeTruthy();
        expect(JSON.parse(decryptSecret(arg.secrets))).toEqual({ access_token: 'at-1', refresh_token: 'rt-1' });
    });

    it('marks the row failed and throws on a token error', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'bad code' }),
        }));
        await expect(GoHighLevelProvider.callback('org-1', { code: 'x' })).rejects.toThrow(/bad code/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
    });
});

describe('callback — broker key-paste fallback', () => {
    it('persists the encrypted key + locationId', async () => {
        await GoHighLevelProvider.callback('org-1', { apiKey: 'pit-abc', locationId: 'loc-9' });
        const arg = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(arg.config.locationId).toBe('loc-9');
        expect(arg.expires_at).toBeNull();
        expect(JSON.parse(decryptSecret(arg.secrets))).toEqual({ access_token: 'pit-abc' });
    });
    it('throws without an API key', async () => {
        await expect(GoHighLevelProvider.callback('org-1', { locationId: 'loc-9' })).rejects.toThrow(/API key/i);
    });
    it('throws without a location id', async () => {
        await expect(GoHighLevelProvider.callback('org-1', { apiKey: 'pit-abc' })).rejects.toThrow(/Location ID/i);
    });
});

describe('refresh', () => {
    it('no-op for an API-key row (no refresh_token stored)', async () => {
        integrationRepository.getByProvider.mockResolvedValueOnce({
            secrets: encryptSecret(JSON.stringify({ access_token: 'pit-abc' })), config: {},
        });
        expect(await GoHighLevelProvider.refresh('org-1')).toEqual({ ok: true });
        expect(integrationRepository.claimRefresh).not.toHaveBeenCalled();
    });

    it('rotates the OAuth token using the stored refresh_token', async () => {
        Object.assign(process.env, OAUTH_ENV);
        integrationRepository.getByProvider.mockResolvedValueOnce({
            secrets: encryptSecret(JSON.stringify({ access_token: 'at-old', refresh_token: 'rt-old' })),
            config: { locationId: 'loc-9' },
        });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 86399, locationId: 'loc-9' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const res = await GoHighLevelProvider.refresh('org-1');
        expect(res).toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][1].body).toContain('grant_type=refresh_token');
        const arg = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(JSON.parse(decryptSecret(arg.secrets))).toEqual({ access_token: 'at-new', refresh_token: 'rt-new' });
        expect(integrationRepository.clearRefresh).toHaveBeenCalledWith('org-1', 'gohighlevel');
    });
});

describe('revoke', () => {
    it('marks the row revoked', async () => {
        await GoHighLevelProvider.revoke('org-1');
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-1', 'gohighlevel');
    });
});
