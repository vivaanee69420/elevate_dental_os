import { describe, it, expect, vi, beforeEach } from 'vitest';
import { integrationConnectSchema } from '../src/models/integration.model.js';
import { DentallyProvider } from '../src/lib/integrations/dentally-provider.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { encryptSecret, decryptSecret } from '../src/lib/crypto.js';

describe('integrationConnectSchema.method', () => {
  it('accepts method oauth/key and defaults to undefined', () => {
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'oauth' }).method).toBe('oauth');
    expect(integrationConnectSchema.parse({ provider: 'dentally', method: 'key' }).method).toBe('key');
    expect(integrationConnectSchema.parse({ provider: 'dentally' }).method).toBeUndefined();
  });
  it('rejects an unknown method', () => {
    expect(() => integrationConnectSchema.parse({ provider: 'dentally', method: 'nope' })).toThrow();
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.DENTALLY_CLIENT_ID = 'cid';
  process.env.DENTALLY_CLIENT_SECRET = 'csecret';
  process.env.OAUTH_STATE_SECRET = 'state-secret-state-secret-32chars!';
  process.env.BACKEND_PUBLIC_URL = 'https://app.example.com';
  delete process.env.DENTALLY_SCOPES;
});

describe('DentallyProvider.authorize', () => {
  it('returns requiresKeyPaste when method=key', async () => {
    vi.spyOn(integrationRepository, 'upsert').mockResolvedValue({});
    const res = await DentallyProvider.authorize('org1', { method: 'key' });
    expect(res.requiresKeyPaste).toBe(true);
    expect(res.redirectUrl).toBeUndefined();
  });

  it('returns a Dentally redirectUrl when method=oauth (default)', async () => {
    vi.spyOn(integrationRepository, 'upsert').mockResolvedValue({});
    const res = await DentallyProvider.authorize('org1', {});
    const url = new URL(res.redirectUrl);
    expect(url.origin + url.pathname).toBe('https://login.dentally.co/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/oauth/dentally/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('throws "not configured" when client id missing', async () => {
    delete process.env.DENTALLY_CLIENT_ID;
    await expect(DentallyProvider.authorize('org1', {})).rejects.toThrow(/not configured/i);
  });
});

describe('DentallyProvider.callback', () => {
  it('exchanges a code and persists encrypted tokens + expires_at', async () => {
    let saved;
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'Bearer', expires_in: 7200, scope: 'read' }),
    });
    const res = await DentallyProvider.callback('org1', { code: 'abc' });
    expect(res.ok).toBe(true);
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.access_token).toBe('AT');
    expect(secrets.refresh_token).toBe('RT');
    expect(saved.status).toBe('active');
    expect(new Date(saved.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('persists an apiKey when payload carries apiKey (key path, expires_at null)', async () => {
    let saved;
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    await DentallyProvider.callback('org1', { apiKey: 'KEY123' });
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.apiKey).toBe('KEY123');
    expect(saved.expires_at).toBeNull();
  });

  it('throws when neither code nor apiKey provided', async () => {
    await expect(DentallyProvider.callback('org1', {})).rejects.toThrow(/code or apiKey/i);
  });

  it('marks failed on a token-exchange error', async () => {
    vi.spyOn(integrationRepository, 'markFailed').mockResolvedValue();
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    await expect(DentallyProvider.callback('org1', { code: 'bad' })).rejects.toThrow(/invalid_grant|exchange/i);
    expect(integrationRepository.markFailed).toHaveBeenCalled();
  });
});

describe('DentallyProvider.refresh', () => {
  it('skips when the refresh is already claimed', async () => {
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(false);
    const res = await DentallyProvider.refresh('org1');
    expect(res.skipped).toBeTruthy();
  });

  it('is a no-op for an apiKey row', async () => {
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(true);
    vi.spyOn(integrationRepository, 'clearRefresh').mockResolvedValue();
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      secrets: encryptSecret(JSON.stringify({ apiKey: 'K' })),
    });
    const res = await DentallyProvider.refresh('org1');
    expect(res.ok).toBe(true);
  });

  it('rotates the token pair on success', async () => {
    let saved;
    vi.spyOn(integrationRepository, 'claimRefresh').mockResolvedValue(true);
    vi.spyOn(integrationRepository, 'clearRefresh').mockResolvedValue();
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      secrets: encryptSecret(JSON.stringify({ access_token: 'OLD', refresh_token: 'OLDRT' })),
      config: {},
    });
    vi.spyOn(integrationRepository, 'upsertSecrets').mockImplementation(async (_o, _p, row) => { saved = row; });
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'NEW', refresh_token: 'NEWRT', token_type: 'Bearer', expires_in: 7200 }),
    });
    await DentallyProvider.refresh('org1');
    const secrets = JSON.parse(decryptSecret(saved.secrets));
    expect(secrets.access_token).toBe('NEW');
    expect(secrets.refresh_token).toBe('NEWRT');
  });
});
