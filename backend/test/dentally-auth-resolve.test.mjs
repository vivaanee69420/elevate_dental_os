import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDentallyAuth, dentallyFetchWithRefresh } from '../src/lib/integrations/dentally-sync.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { DentallyProvider } from '../src/lib/integrations/dentally-provider.js';
import { encryptSecret } from '../src/lib/crypto.js';

beforeEach(() => vi.restoreAllMocks());

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 1000).toISOString();

describe('resolveDentallyAuth', () => {
  it('returns the apiKey bearer and never refreshes', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ apiKey: 'K' })), expires_at: null };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer K');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns the OAuth bearer without refresh when the token is fresh', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'AT' })), expires_at: future() };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer AT');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes a stale OAuth token then returns the new bearer', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'NEW' })), expires_at: future(),
    });
    const integ = { organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'OLD' })), expires_at: past() };
    expect(await resolveDentallyAuth('o1', integ)).toBe('Bearer NEW');
    expect(refresh).toHaveBeenCalledWith('o1');
  });
});

describe('dentallyFetchWithRefresh', () => {
  it('refreshes once on a 401 then retries with the new bearer', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'NEW' })), expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    let call = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      call += 1;
      return call === 1 ? { status: 401, ok: false } : { status: 200, ok: true };
    });
    const { res, auth } = await dentallyFetchWithRefresh('o1', 'Bearer OLD', 'https://api.dentally.co/v1/x');
    expect(res.status).toBe(200);
    expect(auth).toBe('Bearer NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on a 200', async () => {
    const refresh = vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockResolvedValue({ status: 200, ok: true });
    const { res, auth } = await dentallyFetchWithRefresh('o1', 'Bearer OLD', 'https://api.dentally.co/v1/x');
    expect(res.status).toBe(200);
    expect(auth).toBe('Bearer OLD');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns the 401 response as-is when refresh yields no new token', async () => {
    vi.spyOn(DentallyProvider, 'refresh').mockResolvedValue({ ok: true });
    vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue({
      organisation_id: 'o1', secrets: encryptSecret(JSON.stringify({ access_token: 'OLD' })), expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    vi.spyOn(global, 'fetch').mockResolvedValue({ status: 401, ok: false });
    const { res } = await dentallyFetchWithRefresh('o1', 'Bearer OLD', 'https://api.dentally.co/v1/x');
    expect(res.status).toBe(401);
  });
});
