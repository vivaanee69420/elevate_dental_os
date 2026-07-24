// GoHighLevel conversations — pure mappers (channel + message -> communications row)
// + the paginated syncConversations pull.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapMessageChannel, messageRow, syncConversations } from '../src/lib/integrations/gohighlevel-conversations.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { supaRec } from './setup.js';

describe('mapMessageChannel', () => {
    it('maps GHL message types to our channel enum', () => {
        expect(mapMessageChannel('TYPE_SMS')).toBe('sms');
        expect(mapMessageChannel('TYPE_EMAIL')).toBe('email');
        expect(mapMessageChannel('TYPE_WHATSAPP')).toBe('whatsapp');
        expect(mapMessageChannel('TYPE_CALL')).toBe('call');
    });
    it('returns null for channels we cannot store (skipped, not a CHECK violation)', () => {
        expect(mapMessageChannel('TYPE_WEBCHAT')).toBeNull();
        expect(mapMessageChannel('TYPE_FACEBOOK')).toBeNull();
        expect(mapMessageChannel('')).toBeNull();
    });
});

describe('messageRow', () => {
    it('builds a communications row with resolved contact + external id + provider metadata', () => {
        const row = messageRow('org-1', {
            id: 'msg-1', messageType: 'TYPE_SMS', direction: 'inbound', body: 'hi', status: 'delivered',
            dateAdded: '2026-06-01T10:00:00Z',
        }, 'contact-uuid', 'conv-9');
        expect(row).toMatchObject({
            organisation_id: 'org-1', contact_id: 'contact-uuid', channel: 'sms',
            direction: 'inbound', body: 'hi', external_id: 'msg-1',
            metadata: { provider: 'gohighlevel', conversationId: 'conv-9', messageType: 'TYPE_SMS' },
            created_at: '2026-06-01T10:00:00Z',
        });
    });
    it('treats non-inbound as outbound and tolerates a null contact', () => {
        const row = messageRow('o', { id: 'm2', type: 'TYPE_EMAIL', direction: 'outbound', body: 'x' }, null, 'c1');
        expect(row).toMatchObject({ channel: 'email', direction: 'outbound', contact_id: null });
    });
    it('returns null for an unmappable channel', () => {
        expect(messageRow('o', { id: 'm3', messageType: 'TYPE_WEBCHAT', body: 'x' }, 'c', 'cv')).toBeNull();
    });
    it('stamps integration_account_id when the sync is account-scoped', () => {
        const row = messageRow('org-1', {
            id: 'm9', messageType: 'TYPE_SMS', direction: 'inbound', body: 'hi',
        }, 'c-1', 'conv-1', 'acc-9');
        expect(row.integration_account_id).toBe('acc-9');
    });
});

describe('syncConversations pagination', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    // Regression for the empty-Inbox bug: the pull must page through ALL threads
    // (not the first 100) by advancing the GHL cursor (startAfterDate=<last
    // sort[0]>), and each page's messages must upsert. The root cause of the live
    // bug (a PARTIAL unique index that PostgREST's ON CONFLICT could not infer)
    // is guarded by migration 000084 + a full-index re-run, not reproducible
    // against the in-memory Supabase fake; this test pins the pagination control
    // flow that surfaces all of it.
    it('pages via the cursor until a short page and upserts every page', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { locationId: 'loc-1' },
        };
        let upsertedRows = 0;
        supaRec.resultProvider = (q) => {
            if (q.table === 'communications' && q.upsertVals) {
                const rows = q.upsertVals;
                upsertedRows += rows.length;
                return { data: rows.map((_, i) => ({ id: `id-${i}` })), error: null };
            }
            return { data: [], error: null }; // empty contact map (ourContactMap)
        };
        const searchCalls = [];
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('/conversations/search')) {
                searchCalls.push(u);
                const page2 = u.includes('startAfterDate=');
                const conversations = page2
                    ? [{ id: 'c3', contactId: 'gc3', sort: [300] }]                              // 1 < limit 2 -> stop
                    : [{ id: 'c1', contactId: 'gc1', sort: [100] }, { id: 'c2', contactId: 'gc2', sort: [200] }];
                return { ok: true, status: 200, json: async () => ({ conversations, total: 3 }) };
            }
            const id = u.match(/conversations\/([^/]+)\/messages/)[1];
            return {
                ok: true, status: 200,
                json: async () => ({ messages: { messages: [{ id: `m-${id}`, messageType: 'TYPE_SMS', direction: 'inbound', body: 'hi' }] } }),
            };
        });

        const res = await syncConversations('org-1', integration, { pageSize: 2, concurrency: 2, perConv: 5 });

        expect(searchCalls.length).toBe(2);                     // page 1 + page 2, then short page stops
        expect(searchCalls[0]).not.toContain('startAfterDate');
        expect(searchCalls[1]).toContain('startAfterDate=200'); // cursor = page 1's last sort[0]
        expect(res.conversations).toBe(3);
        expect(res.messages).toBe(3);                           // 3 threads x 1 message
        expect(upsertedRows).toBe(3);
    });

    // Incremental pull: threads are sorted newest-first, so once a page shows a
    // thread older than `since` everything after it is older too — stop paging,
    // skip its message fetch, and never touch the historical tail.
    it('stops at `since`: only newer threads fetch messages, no further pages, rows stamped with the account', async () => {
        const integration = {
            secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })),
            config: { locationId: 'loc-1' },
        };
        let upserted = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'communications' && q.upsertVals) {
                upserted = upserted.concat(q.upsertVals);
                return { data: q.upsertVals.map((_, i) => ({ id: `id-${i}` })), error: null };
            }
            return { data: [], error: null };
        };
        const searchCalls = [];
        const messageCalls = [];
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('/conversations/search')) {
                searchCalls.push(u);
                return {
                    ok: true, status: 200,
                    json: async () => ({ conversations: [
                        { id: 'c-new', contactId: 'g1', sort: [300] },
                        { id: 'c-old', contactId: 'g2', sort: [100] },
                    ] }),
                };
            }
            const id = u.match(/conversations\/([^/]+)\/messages/)[1];
            messageCalls.push(id);
            return {
                ok: true, status: 200,
                json: async () => ({ messages: { messages: [{ id: `m-${id}`, messageType: 'TYPE_SMS', direction: 'inbound', body: 'hi' }] } }),
            };
        });

        const res = await syncConversations('org-1', integration, {
            pageSize: 2, since: 200, integrationAccountId: 'acc-9',
        });

        expect(searchCalls.length).toBe(1);      // full page, but stale tail -> no page 2
        expect(messageCalls).toEqual(['c-new']); // stale thread's messages never fetched
        expect(res.conversations).toBe(1);
        expect(upserted.length).toBe(1);
        expect(upserted[0].integration_account_id).toBe('acc-9');
    });

    it('returns zero without a locationId (cannot scope the GHL search)', async () => {
        const integration = { secrets: encryptSecret(JSON.stringify({ access_token: 'tok' })), config: {} };
        global.fetch = vi.fn();
        const res = await syncConversations('org-1', integration);
        expect(res).toEqual({ conversations: 0, messages: 0 });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
