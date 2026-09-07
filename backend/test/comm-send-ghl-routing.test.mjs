// comm.service.send — which provider carries an outbound reply.
//
// The bug: the GHL branch read its credential from the single `integrations`
// row. Every org connected the multi-subaccount way has NO secrets there (the
// tokens live per Location in integration_accounts), so the branch was skipped
// and the reply went out over Twilio/Postmark instead — reaching the patient
// from a different number, and never threading into the GHL conversation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactRow = { current: null };
vi.mock('../src/lib/supabase.js', () => ({
    serviceClient: {
        from: vi.fn(() => ({
            select: () => ({
                eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: contactRow.current }) }) }),
            }),
        })),
    },
}));

const created = { current: null };
vi.mock('../src/repositories/comm.repository.js', () => ({
    commRepository: {
        create: vi.fn(async (row) => { created.current = row; return { data: row, error: null }; }),
    },
}));

vi.mock('../src/lib/tenant-guard.js', () => ({ assertOrgOwns: vi.fn().mockResolvedValue(undefined) }));

const marker = { current: null };
vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(async () => marker.current) },
}));

const accounts = { current: [] };
vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: { list: vi.fn(async () => accounts.current) },
}));

const sendAuthForContact = vi.fn();
vi.mock('../src/lib/integrations/gohighlevel-sync.js', () => ({
    sendAuthForContact: (...a) => sendAuthForContact(...a),
}));

const ghlSend = vi.fn(async () => ({ messageId: 'ghl-msg-1', conversationId: 'conv-1' }));
vi.mock('../src/lib/integrations/gohighlevel-conversations.js', () => ({
    sendMessage: (...a) => ghlSend(...a),
}));

const sendSMS = vi.fn(async () => ({ external_id: 'twilio-1' }));
vi.mock('../src/lib/messaging.js', () => ({
    sendSMS: (...a) => sendSMS(...a),
    sendEmail: vi.fn(async () => ({ external_id: 'postmark-1' })),
}));

process.env.INTEGRATIONS_SECRET_KEY = 'enc-key';
const { encryptSecret } = await import('../src/lib/crypto.js');
const { commService } = await import('../src/services/comm.service.js');

const INPUT = { contact_id: 'c-1', channel: 'sms', body: 'Hello', to: '+447700900000' };

beforeEach(() => {
    vi.clearAllMocks();
    contactRow.current = { ghl_contact_id: 'ghl-1', integration_account_id: 'acct-1' };
    marker.current = null;
    accounts.current = [{ id: 'acct-1', status: 'active' }];
    sendAuthForContact.mockResolvedValue('tok-A');
});

describe('commService.send — GoHighLevel routing', () => {
    it("sends through the contact's subaccount when the marker row holds no secrets", async () => {
        // THE regression. This org is connected — just not on the row the old
        // code looked at.
        await commService.send('org-1', INPUT);
        expect(ghlSend).toHaveBeenCalledWith('org-1', 'tok-A', expect.objectContaining({ contactId: 'ghl-1' }));
        expect(sendSMS).not.toHaveBeenCalled();
        expect(created.current.metadata).toEqual({ provider: 'gohighlevel', conversationId: 'conv-1' });
    });

    it('falls back to the legacy single row when no subaccount resolves', async () => {
        sendAuthForContact.mockResolvedValue(null);
        marker.current = {
            status: 'active',
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok-legacy' })),
        };
        await commService.send('org-1', INPUT);
        expect(ghlSend).toHaveBeenCalledWith('org-1', 'tok-legacy', expect.anything());
    });

    it('falls back to the native provider when no GHL credential resolves at all', async () => {
        sendAuthForContact.mockResolvedValue(null);
        // Revoked subaccount, no legacy row: the patient still gets the message.
        await commService.send('org-1', INPUT);
        expect(ghlSend).not.toHaveBeenCalled();
        expect(sendSMS).toHaveBeenCalled();
        expect(created.current.metadata).toEqual({});
    });

    it('never reads contacts when the org has no GoHighLevel connection', async () => {
        accounts.current = [];
        const { serviceClient } = await import('../src/lib/supabase.js');
        await commService.send('org-1', INPUT);
        // The lookup is pure cost for an org that cannot use the answer.
        expect(serviceClient.from).not.toHaveBeenCalled();
        expect(sendSMS).toHaveBeenCalled();
    });

    it('uses the native provider for a contact GoHighLevel does not know', async () => {
        contactRow.current = { ghl_contact_id: null, integration_account_id: null };
        await commService.send('org-1', INPUT);
        expect(sendAuthForContact).not.toHaveBeenCalled();
        expect(sendSMS).toHaveBeenCalled();
    });
});
