// An OAuth access token lasts about a day; a Private Integration Token does
// not expire. syncAccount was written when only tokens existed, so it read
// secrets.access_token once and used it — correct then, and a connection that
// works for one day and fails silently every night after, now.
//
// ensureAccountToken is the seam. These tests pin the two halves that matter:
// a token row must be left completely alone, and an OAuth row must roll
// forward exactly once even when two syncs race.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const repo = {
    claimRefresh: vi.fn().mockResolvedValue(true),
    clearRefresh: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({}),
    mergeConfig: vi.fn().mockResolvedValue({}),
};
vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: repo,
}));

const exchangeRefreshToken = vi.fn();
vi.mock('../src/lib/integrations/gohighlevel-provider.js', () => ({
    exchangeRefreshToken: (...a) => exchangeRefreshToken(...a),
}));

process.env.INTEGRATIONS_SECRET_KEY = 'enc-key';
const { encryptSecret, decryptSecret } = await import('../src/lib/crypto.js');
const { ensureAccountToken, TOKEN_SKEW_MS } = await import('../src/lib/integrations/gohighlevel-sync.js');

const secretsOf = (obj) => encryptSecret(JSON.stringify(obj));
const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeEach(() => {
    vi.clearAllMocks();
    repo.claimRefresh.mockResolvedValue(true);
});

describe('ensureAccountToken', () => {
    it('leaves a Private Integration Token row untouched', async () => {
        const account = { id: 'a1', secrets: secretsOf({ access_token: 'pit-abc' }), config: {} };
        expect(await ensureAccountToken('org-1', account)).toBe('pit-abc');
        // No claim, no exchange — a PIT has nothing to refresh, and calling
        // GHL for one would fail the sync of an account that was fine.
        expect(exchangeRefreshToken).not.toHaveBeenCalled();
        expect(repo.claimRefresh).not.toHaveBeenCalled();
    });

    it('leaves an OAuth token that is still well within its life', async () => {
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-live', refresh_token: 'rt-1' }),
            config: { auth: 'oauth', expires_at: inHours(6) },
        };
        expect(await ensureAccountToken('org-1', account)).toBe('at-live');
        expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it('refreshes a token that is close to expiry, not merely one that has expired', async () => {
        exchangeRefreshToken.mockResolvedValue({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 86399 });
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-old', refresh_token: 'rt-old' }),
            // Still valid, but not for long enough to survive a full pull.
            config: { auth: 'oauth', expires_at: new Date(Date.now() + TOKEN_SKEW_MS / 2).toISOString() },
        };
        expect(await ensureAccountToken('org-1', account)).toBe('at-new');
        expect(exchangeRefreshToken).toHaveBeenCalledWith('rt-old');
        const [, , patch] = repo.update.mock.calls[0];
        expect(JSON.parse(decryptSecret(patch.secrets))).toEqual({ access_token: 'at-new', refresh_token: 'rt-new' });
        expect(repo.clearRefresh).toHaveBeenCalledWith('org-1', 'a1');
    });

    it('refreshes when the row carries no expiry at all', async () => {
        exchangeRefreshToken.mockResolvedValue({ access_token: 'at-new', expires_in: 86399 });
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-old', refresh_token: 'rt-old' }),
            config: { auth: 'oauth' },
        };
        // An undateable token is refreshed rather than gambled on.
        expect(await ensureAccountToken('org-1', account)).toBe('at-new');
    });

    it('keeps the current refresh token when GHL returns none', async () => {
        exchangeRefreshToken.mockResolvedValue({ access_token: 'at-new', expires_in: 86399 });
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-old', refresh_token: 'rt-old' }),
            config: { auth: 'oauth', expires_at: inHours(-1) },
        };
        await ensureAccountToken('org-1', account);
        const [, , patch] = repo.update.mock.calls[0];
        // Dropping it would leave the account unable to ever refresh again.
        expect(JSON.parse(decryptSecret(patch.secrets)).refresh_token).toBe('rt-old');
    });

    it('does not spend the refresh token twice when two syncs race', async () => {
        // GHL rotates the refresh token on use, so the second spend would
        // invalidate the connection the first one just renewed.
        repo.claimRefresh.mockResolvedValue(false);
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-old', refresh_token: 'rt-old' }),
            config: { auth: 'oauth', expires_at: inHours(-1) },
        };
        expect(await ensureAccountToken('org-1', account)).toBe('at-old');
        expect(exchangeRefreshToken).not.toHaveBeenCalled();
    });

    it('releases the claim even when the exchange fails', async () => {
        exchangeRefreshToken.mockRejectedValue(new Error('invalid_grant'));
        const account = {
            id: 'a1',
            secrets: secretsOf({ access_token: 'at-old', refresh_token: 'rt-old' }),
            config: { auth: 'oauth', expires_at: inHours(-1) },
        };
        await expect(ensureAccountToken('org-1', account)).rejects.toThrow(/invalid_grant/);
        // A stuck claim flag blocks every future refresh for this account,
        // and that failure surfaces a day later with no obvious cause.
        expect(repo.clearRefresh).toHaveBeenCalledWith('org-1', 'a1');
    });
});
