// Which GoHighLevel credential sends a reply.
//
// A GHL contact belongs to exactly ONE Location, and each Location has its own
// credential. comm.service used to send through the single `integrations` row,
// which is empty for every org connected the multi-subaccount way — so those
// orgs silently fell back to Twilio/Postmark, and the reply never threaded in
// GHL. These pin the resolution, including the two cases where guessing would
// be worse than declining.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const repo = {
    getByIdWithSecrets: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
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
const { encryptSecret } = await import('../src/lib/crypto.js');
const { sendAuthForContact } = await import('../src/lib/integrations/gohighlevel-sync.js');

const account = (over = {}) => ({
    id: 'acct-1',
    provider: 'gohighlevel',
    status: 'active',
    secrets: encryptSecret(JSON.stringify({ access_token: 'tok-A' })),
    config: {},
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    repo.list.mockResolvedValue([]);
});

describe('sendAuthForContact', () => {
    it("uses the contact's own subaccount token", async () => {
        repo.getByIdWithSecrets.mockResolvedValue(account());
        const token = await sendAuthForContact('org-1', { integration_account_id: 'acct-1' });
        expect(token).toBe('tok-A');
        expect(repo.getByIdWithSecrets).toHaveBeenCalledWith('org-1', 'acct-1');
        // Never a scan for an alternative — the stamp IS the answer.
        expect(repo.list).not.toHaveBeenCalled();
    });

    it('refreshes an OAuth subaccount before handing the token over', async () => {
        exchangeRefreshToken.mockResolvedValue({ access_token: 'tok-fresh', refresh_token: 'rt-2', expires_in: 86399 });
        repo.getByIdWithSecrets.mockResolvedValue(account({
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok-stale', refresh_token: 'rt-1' })),
            config: { auth: 'oauth', expires_at: new Date(Date.now() - 1000).toISOString() },
        }));
        // Sending with a day-old OAuth token is a 401 the patient never hears about.
        expect(await sendAuthForContact('org-1', { integration_account_id: 'acct-1' })).toBe('tok-fresh');
    });

    it('declines when the stamped subaccount is revoked', async () => {
        repo.getByIdWithSecrets.mockResolvedValue(account({ status: 'revoked' }));
        // Another Location's token would thread the reply into the wrong
        // subaccount, which is worse than falling back to SMS.
        expect(await sendAuthForContact('org-1', { integration_account_id: 'acct-1' })).toBeNull();
        expect(repo.list).not.toHaveBeenCalled();
    });

    it('declines when the stamped account belongs to another provider', async () => {
        repo.getByIdWithSecrets.mockResolvedValue(account({ provider: 'callrail' }));
        expect(await sendAuthForContact('org-1', { integration_account_id: 'acct-1' })).toBeNull();
    });

    it('uses the only live subaccount for an unstamped contact', async () => {
        repo.list.mockResolvedValue([{ id: 'acct-1', status: 'active' }]);
        repo.getByIdWithSecrets.mockResolvedValue(account());
        // Contacts pulled by the retired org-wide sync carry no stamp; with one
        // Location there is nothing ambiguous about it.
        expect(await sendAuthForContact('org-1', { integration_account_id: null })).toBe('tok-A');
    });

    it('declines for an unstamped contact when several subaccounts exist', async () => {
        repo.list.mockResolvedValue([
            { id: 'acct-1', status: 'active' },
            { id: 'acct-2', status: 'active' },
        ]);
        expect(await sendAuthForContact('org-1', {})).toBeNull();
        expect(repo.getByIdWithSecrets).not.toHaveBeenCalled();
    });

    it('ignores revoked rows when counting the live subaccounts', async () => {
        repo.list.mockResolvedValue([
            { id: 'acct-1', status: 'active' },
            { id: 'acct-2', status: 'revoked' },
        ]);
        repo.getByIdWithSecrets.mockResolvedValue(account());
        expect(await sendAuthForContact('org-1', {})).toBe('tok-A');
    });

    it('declines when the org has no subaccounts at all', async () => {
        expect(await sendAuthForContact('org-1', {})).toBeNull();
    });
});
