import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/aws-sns.js', () => ({
    verifySnsSignature: vi.fn(),
    confirmSubscription: vi.fn(async () => {}),
}));
vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: { upsertSuppression: vi.fn(async () => {}) },
}));
vi.mock('../src/lib/supabase.js', () => ({
    serviceClient: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { sesEventController } from '../src/controllers/ses-event.controller.js';
import { verifySnsSignature, confirmSubscription } from '../src/lib/aws-sns.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

function mockRes() {
    return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (obj) => ({ body: Buffer.from(JSON.stringify(obj)) });
beforeEach(() => vi.clearAllMocks());

describe('SES event webhook', () => {
    it('rejects a bad signature with 403', async () => {
        verifySnsSignature.mockResolvedValueOnce(false);
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: '{}' }), res);
        expect(res.code).toBe(403);
        expect(repo.upsertSuppression).not.toHaveBeenCalled();
    });

    it('auto-confirms a subscription', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://x' }), res);
        expect(confirmSubscription).toHaveBeenCalledWith('https://x');
        expect(res.body).toEqual({ ok: true, confirmed: true });
    });

    it('suppresses a permanent bounce recipient', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const inner = JSON.stringify({
            eventType: 'Bounce',
            bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'x@y.com' }] },
            mail: { messageId: 'm1' },
        });
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: inner }), res);
        expect(repo.upsertSuppression).toHaveBeenCalledWith('x@y.com', 'bounce', expect.any(String));
    });

    it('does NOT suppress a transient (non-permanent) bounce', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const inner = JSON.stringify({
            eventType: 'Bounce',
            bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'x@y.com' }] },
            mail: { messageId: 'm1' },
        });
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: inner }), res);
        expect(repo.upsertSuppression).not.toHaveBeenCalled();
    });

    it('suppresses a complaint recipient', async () => {
        verifySnsSignature.mockResolvedValueOnce(true);
        const inner = JSON.stringify({
            eventType: 'Complaint',
            complaint: { complainedRecipients: [{ emailAddress: 'z@y.com' }] },
            mail: { messageId: 'm2' },
        });
        const res = mockRes();
        await sesEventController.handle(req({ Type: 'Notification', Message: inner }), res);
        expect(repo.upsertSuppression).toHaveBeenCalledWith('z@y.com', 'complaint', expect.any(String));
    });
});
