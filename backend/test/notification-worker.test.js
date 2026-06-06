import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: {
        claimPendingDeliveries: vi.fn(),
        markDeliverySent: vi.fn(async () => {}),
        markDeliveryRetry: vi.fn(async () => {}),
    },
}));

import { notificationService } from '../src/services/notification.service.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

beforeEach(() => vi.clearAllMocks());
const NOW = new Date('2026-06-06T12:00:00.000Z');

describe('drainOnce', () => {
    it('sends an email delivery via the injected SES sender and marks it sent', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd1', channel: 'email', to_address: 'a@b.com', attempts: 0, notification: { title: 'Hi', body: 'x' } },
        ]);
        const ses = { sendEmail: vi.fn(async () => 'ses-123') };
        const sns = { sendSMS: vi.fn() };
        await notificationService.drainOnce({ ses, sns, now: NOW });
        expect(ses.sendEmail).toHaveBeenCalledOnce();
        expect(repo.markDeliverySent).toHaveBeenCalledWith('d1', 'ses-123', NOW.toISOString());
    });

    it('on send failure schedules a retry with backoff, not failed (attempt 1)', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd2', channel: 'email', to_address: 'a@b.com', attempts: 0, notification: { title: 'Hi', body: 'x' } },
        ]);
        const ses = { sendEmail: vi.fn(async () => { throw new Error('boom'); }) };
        await notificationService.drainOnce({ ses, sns: {}, now: NOW });
        const next = new Date(NOW.getTime() + 60000).toISOString();
        expect(repo.markDeliveryRetry).toHaveBeenCalledWith('d2', 1, 'boom', next, false);
    });

    it('marks failed after the 5th attempt', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd3', channel: 'email', to_address: 'a@b.com', attempts: 4, notification: { title: 'Hi', body: 'x' } },
        ]);
        const ses = { sendEmail: vi.fn(async () => { throw new Error('boom'); }) };
        await notificationService.drainOnce({ ses, sns: {}, now: NOW });
        const lastBackoff = new Date(NOW.getTime() + 43200000).toISOString();
        expect(repo.markDeliveryRetry).toHaveBeenCalledWith('d3', 5, 'boom', lastBackoff, true);
    });

    it('sends an sms delivery via the injected SNS sender', async () => {
        repo.claimPendingDeliveries.mockResolvedValueOnce([
            { id: 'd4', channel: 'sms', to_address: '+447700900000', attempts: 0, notification: { title: 'Hi', body: 'x' } },
        ]);
        const sns = { sendSMS: vi.fn(async () => 'sns-9') };
        await notificationService.drainOnce({ ses: {}, sns, now: NOW });
        expect(sns.sendSMS).toHaveBeenCalledOnce();
        expect(repo.markDeliverySent).toHaveBeenCalledWith('d4', 'sns-9', NOW.toISOString());
    });
});
