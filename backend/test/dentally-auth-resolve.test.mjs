import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDentallyAuth } from '../src/lib/integrations/dentally-sync.js';
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
