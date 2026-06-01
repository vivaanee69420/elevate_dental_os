// GoHighLevel conversations — pure mappers (channel + message -> communications row).
import { describe, it, expect } from 'vitest';
import { mapMessageChannel, messageRow } from '../src/lib/integrations/gohighlevel-conversations.js';

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
});
