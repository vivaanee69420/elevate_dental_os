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

vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: {
        getByLocation: vi.fn().mockResolvedValue(null),
        insert: vi.fn(async (orgId, fields) => ({ id: 'acct-1', ...fields })),
        update: vi.fn(async (orgId, id, patch) => ({ id, ...patch })),
    },
}));

// The OAuth callback fires a first pull; stub the sync so the test does not
// reach the network, and so the bootstrap call itself can be asserted.
const bootstrapAccount = vi.fn().mockResolvedValue({});
const fetchLocation = vi.fn().mockResolvedValue({ id: 'loc-9', name: 'Rochester' });
vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
    bootstrapAccount: (...a) => bootstrapAccount(...a),
    fetchLocation: (...a) => fetchLocation(...a),
    syncOneOrg: vi.fn().mockResolvedValue({}),
}));

import { integrationRepository } from '../src/repositories/integration.repository.js';
import { integrationAccountRepository } from '../src/repositories/integration-account.repository.js';
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
        // The VERSIONED path. The unversioned one is GHL's v1 endpoint, which
        // answers "No integration found with the id: <client id>" for any app
        // created on the current marketplace — a dead end that looks like a bad
        // credential and is not one.
        expect(u.pathname).toBe('/v2/oauth/chooselocation');
        // Not sent unless the operator supplies it.
        expect(u.searchParams.has('version_id')).toBe(false);
        expect(integrationRepository.upsert).toHaveBeenCalledWith('org-1', 'gohighlevel', { status: 'pending' });
    });
});

describe('authorize — requested scopes', () => {
    it('asks for the write scope that replying needs, and no other write scope', async () => {
        Object.assign(process.env, OAUTH_ENV);
        const res = await GoHighLevelProvider.authorize('org-1');
        const scopes = new URL(res.redirectUrl).searchParams.get('scope').split(' ');
        // Inbox replies POST /conversations/messages as the contact's own
        // subaccount. Without this, an OAuth connection can read a whole
        // conversation and not answer it — and GHL's refusal arrives at send
        // time, long after the connection looked healthy.
        expect(scopes).toContain('conversations/message.write');
        // Everything the sync reads.
        expect(scopes).toEqual(expect.arrayContaining([
            'contacts.readonly', 'opportunities.readonly', 'locations.readonly',
            'workflows.readonly', 'calendars.readonly', 'calendars/events.readonly',
            'conversations.readonly',
        ]));
        // Nothing else may write. A scope is a standing permission over a
        // client's CRM, not a convenience.
        expect(scopes.filter((s) => s.endsWith('.write'))).toEqual(['conversations/message.write']);
    });

    it('passes version_id through when the operator supplies it', async () => {
        Object.assign(process.env, OAUTH_ENV, { GHL_APP_VERSION_ID: 'ver-123' });
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(new URL(res.redirectUrl).searchParams.get('version_id')).toBe('ver-123');
        delete process.env.GHL_APP_VERSION_ID;
    });

    it('honours a GHL_AUTHORIZE_PATH override', async () => {
        Object.assign(process.env, OAUTH_ENV, { GHL_AUTHORIZE_PATH: '/oauth/chooselocation' });
        // The path has moved once already; an operator must be able to follow
        // it without waiting for a deploy.
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(new URL(res.redirectUrl).pathname).toBe('/oauth/chooselocation');
        delete process.env.GHL_AUTHORIZE_PATH;
    });

    it('honours a GHL_SCOPES override', async () => {
        Object.assign(process.env, OAUTH_ENV, { GHL_SCOPES: 'contacts.readonly' });
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(new URL(res.redirectUrl).searchParams.get('scope')).toBe('contacts.readonly');
        delete process.env.GHL_SCOPES;
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
    it('stores the connection as an integration_accounts row, NOT on the marker row', async () => {
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
        expect(res).toMatchObject({ ok: true, locationId: 'loc-9', accountId: 'acct-1' });

        // Token endpoint hit with form-urlencoded grant_type + matching redirect_uri.
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('https://services.leadconnectorhq.com/oauth/token');
        expect(opts.body).toContain('grant_type=authorization_code');
        expect(opts.body).toContain('user_type=Location');
        expect(opts.body).toContain(encodeURIComponent('https://api.example.com/oauth/leadconnector/callback'));

        // THE point of this test. The nightly worker iterates
        // integration_accounts and never reads the marker row, so tokens
        // written there would authenticate, show "Connected", and never sync.
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
        const [orgId, fields] = integrationAccountRepository.insert.mock.calls[0];
        expect(orgId).toBe('org-1');
        expect(fields.provider).toBe('gohighlevel');
        expect(fields.external_account_id).toBe('loc-9');
        expect(fields.status).toBe('active');
        expect(fields.webhook_token).toMatch(/^[0-9a-f]{48}$/);
        expect(JSON.parse(decryptSecret(fields.secrets))).toEqual({ access_token: 'at-1', refresh_token: 'rt-1' });
        // config.auth is what tells the sync this token expires.
        expect(fields.config.auth).toBe('oauth');
        expect(fields.config.companyId).toBe('co-1');
        expect(Date.parse(fields.config.expires_at)).toBeGreaterThan(Date.now());
        // Marker row still flips to active — that is what the tile reads.
        expect(integrationRepository.upsert).toHaveBeenCalledWith('org-1', 'gohighlevel', { status: 'active', last_error: null });
        // And the first pull runs, exactly as adding a token does.
        await new Promise((r) => setImmediate(r));
        expect(bootstrapAccount).toHaveBeenCalledWith('org-1', 'acct-1');
    });

    it('re-authorising a connected Location updates that row instead of adding a second', async () => {
        Object.assign(process.env, OAUTH_ENV);
        integrationAccountRepository.getByLocation.mockResolvedValueOnce({
            id: 'acct-existing', config: { practice_hint: 'keep-me' },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 86399, locationId: 'loc-9' }),
        }));

        await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });

        // A second row for one Location would double every figure it feeds.
        expect(integrationAccountRepository.insert).not.toHaveBeenCalled();
        const [, id, patch] = integrationAccountRepository.update.mock.calls[0];
        expect(id).toBe('acct-existing');
        expect(patch.status).toBe('active');
        // Existing config survives — the practice mapping lives there.
        expect(patch.config.practice_hint).toBe('keep-me');
        expect(patch.config.auth).toBe('oauth');
    });

    it('refuses an authorisation that returns no locationId', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 86399 }),
        }));
        // Without a Location there is nothing to sync, and a row keyed on null
        // would collide with the next one.
        await expect(GoHighLevelProvider.callback('org-1', { code: 'x' })).rejects.toThrow(/locationId/i);
        expect(integrationAccountRepository.insert).not.toHaveBeenCalled();
    });

    it('marks the row failed and throws on a token error', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'bad code' }),
        }));
        await expect(GoHighLevelProvider.callback('org-1', { code: 'x' })).rejects.toThrow(/bad code/);
        expect(integrationRepository.markFailed).toHaveBeenCalled();
        expect(integrationAccountRepository.insert).not.toHaveBeenCalled();
    });
});

describe('authStyle — the token path stays reachable', () => {
    it('offers the key paste when the owner asks for it, even with OAuth configured', async () => {
        Object.assign(process.env, OAUTH_ENV);
        // Declaring plain 'oauth' would make this unreachable for a FIRST
        // connection, because the tile's Connect button redirects immediately.
        const res = await GoHighLevelProvider.authorize('org-1', { method: 'key' });
        expect(res).toMatchObject({ requiresKeyPaste: true, requiresLocationId: true });
        expect(res.redirectUrl).toBeUndefined();
    });
});

describe('callback — AGENCY consent (one consent, N subaccounts)', () => {
    // Installing the app on the agency authorises the COMPANY, so GHL returns
    // companyId and NO locationId. That used to dead-end with "did not return a
    // locationId" — which is the natural install for an agency with many
    // sub-accounts, and the one this org actually did.
    function routeFetch({ locations, mintFails = [] }) {
        return vi.fn(async (url, opts = {}) => {
            const u = String(url);
            if (u.endsWith('/oauth/token')) {
                return { ok: true, json: async () => ({
                    access_token: 'agency-at', refresh_token: 'agency-rt', expires_in: 86399,
                    companyId: 'co-1', userType: 'Company', scope: 'contacts.readonly',
                }) };
            }
            if (u.includes('/oauth/installedLocations')) {
                return { ok: true, json: async () => ({ locations }) };
            }
            if (u.endsWith('/oauth/locationToken')) {
                const locId = new URLSearchParams(opts.body).get('locationId');
                if (mintFails.includes(locId)) {
                    return { ok: false, json: async () => ({ message: 'not authorised for this location' }) };
                }
                return { ok: true, json: async () => ({
                    access_token: `loc-at-${locId}`, expires_in: 86399, locationId: locId, userType: 'Location',
                }) };
            }
            throw new Error(`unexpected fetch: ${u}`);
        });
    }

    it('creates one subaccount per installed location and keeps the agency token separate', async () => {
        Object.assign(process.env, OAUTH_ENV);
        const fetchMock = routeFetch({ locations: [
            { _id: 'loc-1', name: 'Rochester' }, { _id: 'loc-2', name: 'Ashford' },
        ] });
        vi.stubGlobal('fetch', fetchMock);

        const res = await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });
        expect(res).toMatchObject({ ok: true, companyId: 'co-1', locations: 2 });
        expect(res.accounts).toHaveLength(2);
        // SEVERAL locations is a decision, and it is the owner's. An agency
        // install can span every sub-account the agency has; fanning an
        // immediate pull across all of them is how the Dentally connect
        // ingested four practices nobody asked for. Rows yes, pull no.
        expect(res.autoPull).toBe(false);

        // The AGENCY token is the one renewable credential, and it belongs to
        // the company — so it lives on the org row, not on any subaccount.
        const agency = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(JSON.parse(decryptSecret(agency.secrets))).toEqual({
            access_token: 'agency-at', refresh_token: 'agency-rt',
        });
        expect(agency.config.companyId).toBe('co-1');

        // Each Location gets its own row, named from GHL, carrying a MINTED
        // token with no refresh token of its own.
        const rows = integrationAccountRepository.insert.mock.calls.map((c) => c[1]);
        expect(rows.map((r) => r.external_account_id)).toEqual(['loc-1', 'loc-2']);
        expect(rows.map((r) => r.label)).toEqual(['Rochester', 'Ashford']);
        for (const r of rows) {
            expect(r.config.auth).toBe('oauth_company');
            expect(r.config.companyId).toBe('co-1');
            expect(JSON.parse(decryptSecret(r.secrets)).refresh_token).toBeNull();
        }
        expect(JSON.parse(decryptSecret(rows[0].secrets)).access_token).toBe('loc-at-loc-1');
    });

    it('pulls straight away when there is exactly one location', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', routeFetch({ locations: [{ _id: 'loc-1', name: 'Rochester' }] }));
        // One location is not a decision — the same rule dentally-sync applies
        // to a single site.
        const res = await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });
        expect(res.autoPull).toBe(true);
    });

    it('connects the locations that work and names the ones that do not', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', routeFetch({
            locations: [{ _id: 'loc-1', name: 'Rochester' }, { _id: 'loc-2', name: 'Ashford' }],
            mintFails: ['loc-2'],
        }));
        const res = await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });
        // One bad location must not cost the owner the others, and must not
        // vanish either.
        expect(res.accounts).toHaveLength(1);
        expect(res.failed[0]).toMatch(/Ashford/);
        const marker = integrationRepository.upsert.mock.calls.at(-1)[2];
        expect(marker.last_error).toMatch(/Ashford/);
    });

    it('succeeds with zero locations rather than reporting a broken connection', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', routeFetch({ locations: [] }));
        // The consent worked; the app is just not on a sub-account yet, which
        // the owner fixes in GoHighLevel.
        const res = await GoHighLevelProvider.callback('org-1', { code: 'auth-code' });
        expect(res).toMatchObject({ ok: true, locations: 0 });
        expect(integrationAccountRepository.insert).not.toHaveBeenCalled();
    });

    it('names what GHL returned when there is neither a location nor a company', async () => {
        Object.assign(process.env, OAUTH_ENV);
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, json: async () => ({ access_token: 'at', expires_in: 86399, userType: 'Weird' }),
        })));
        // A bare "no locationId" cannot be acted on; the two causes need
        // opposite fixes.
        await expect(GoHighLevelProvider.callback('org-1', { code: 'x' }))
            .rejects.toThrow(/neither a locationId nor a companyId.*userType: Weird/s);
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
