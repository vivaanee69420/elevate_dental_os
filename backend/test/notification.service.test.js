import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository so we assert service behaviour, not SQL.
vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: {
        insertNotifications: vi.fn(async (rows) => rows.map((r, i) => ({ ...r, id: `n${i}` }))),
        getPreferences: vi.fn(async () => []),
        suppressedAddresses: vi.fn(async () => new Set()),
        enqueueDeliveries: vi.fn(async () => {}),
    },
}));

import { notificationService } from '../src/services/notification.service.js';
import { notificationRepository as repo } from '../src/repositories/notification.repository.js';

beforeEach(() => vi.clearAllMocks());

describe('notify()', () => {
    it('inserts one in-app notification per user and enqueues email by default', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'account',
            title: 'Approved',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        expect(repo.insertNotifications).toHaveBeenCalledOnce();
        const enq = repo.enqueueDeliveries.mock.calls[0][0];
        expect(enq).toEqual([
            expect.objectContaining({ channel: 'email', to_address: 'a@b.com' }),
        ]);
    });

    it('skips email when a suppressed address, and skips sms when pref off (default account)', async () => {
        repo.suppressedAddresses.mockResolvedValueOnce(new Set(['a@b.com']));
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'account',
            title: 'Hi',
            recipients: { u1: { email: 'a@b.com', phone: '+447700900000' } },
        });
        expect(repo.enqueueDeliveries).toHaveBeenCalledWith([]); // email suppressed, sms off for 'account'
    });

    it('enqueues sms by default for the integration category', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1'],
            category: 'integration',
            title: 'Sync failed',
            recipients: { u1: { email: 'a@b.com', phone: '+447700900000' } },
        });
        const enq = repo.enqueueDeliveries.mock.calls[0][0];
        expect(enq.map((d) => d.channel).sort()).toEqual(['email', 'sms']);
    });

    it('honours a stored pref that mutes email', async () => {
        repo.getPreferences.mockResolvedValueOnce([{ category: 'account', in_app: true, email: false, sms: false }]);
        await notificationService.notify({
            orgId: 'org-1', userIds: ['u1'], category: 'account', title: 'x',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        expect(repo.enqueueDeliveries).toHaveBeenCalledWith([]);
    });
});
