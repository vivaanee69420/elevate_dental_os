// GoHighLevel provider — API-key (broker) connect: authorize prompts for a key
// + location id, callback persists the encrypted key + locationId, refresh is a
// no-op. Repository is mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        upsert: vi.fn().mockResolvedValue({}),
        upsertSecrets: vi.fn().mockResolvedValue(undefined),
        markRevoked: vi.fn().mockResolvedValue(undefined),
    },
}));

import { integrationRepository } from '../src/repositories/integration.repository.js';
import { GoHighLevelProvider } from '../src/lib/integrations/gohighlevel-provider.js';
import { decryptSecret } from '../src/lib/crypto.js';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTEGRATIONS_SECRET_KEY = 'enc-key';
});

describe('authorize', () => {
    it('prompts for an API key + location id and marks the row pending', async () => {
        const res = await GoHighLevelProvider.authorize('org-1');
        expect(res).toMatchObject({ requiresKeyPaste: true, requiresLocationId: true });
        expect(res.pasteHint).toMatch(/API key/i);
        expect(integrationRepository.upsert).toHaveBeenCalledWith('org-1', 'gohighlevel', { status: 'pending' });
    });
});

describe('callback', () => {
    it('persists the encrypted key + locationId and activates', async () => {
        await GoHighLevelProvider.callback('org-1', { apiKey: 'pit-abc', locationId: 'loc-9' });
        expect(integrationRepository.upsertSecrets).toHaveBeenCalledTimes(1);
        const arg = integrationRepository.upsertSecrets.mock.calls[0][2];
        expect(arg.config.locationId).toBe('loc-9');
        expect(arg.status).toBe('active');
        expect(arg.expires_at).toBeNull();
        // Stored encrypted (string), not plaintext; decrypts back to the key.
        expect(typeof arg.secrets).toBe('string');
        expect(arg.secrets).not.toContain('pit-abc');
        expect(JSON.parse(decryptSecret(arg.secrets))).toEqual({ access_token: 'pit-abc' });
    });

    it('throws without an API key', async () => {
        await expect(GoHighLevelProvider.callback('org-1', { locationId: 'loc-9' })).rejects.toThrow(/API key/i);
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
    });

    it('throws without a location id', async () => {
        await expect(GoHighLevelProvider.callback('org-1', { apiKey: 'pit-abc' })).rejects.toThrow(/Location ID/i);
        expect(integrationRepository.upsertSecrets).not.toHaveBeenCalled();
    });
});

describe('refresh / revoke', () => {
    it('refresh is a no-op for a long-lived API key', async () => {
        expect(await GoHighLevelProvider.refresh('org-1')).toEqual({ ok: true });
    });
    it('revoke marks the row revoked', async () => {
        await GoHighLevelProvider.revoke('org-1');
        expect(integrationRepository.markRevoked).toHaveBeenCalledWith('org-1', 'gohighlevel');
    });
});
