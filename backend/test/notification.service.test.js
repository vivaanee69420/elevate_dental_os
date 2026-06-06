import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository so we assert service behaviour, not SQL. insertNotifications
// returns rows in REVERSE order on purpose, so the test proves the userId->id
// mapping is keyed by user_id and not by array position.
vi.mock('../src/repositories/notification.repository.js', () => ({
    notificationRepository: {
        insertNotifications: vi.fn(async (rows) => rows.map((r, i) => ({ ...r, id: `n${i}` })).reverse()),
        getPreferencesBatch: vi.fn(async () => new Map()),
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
        repo.getPreferencesBatch.mockResolvedValueOnce(
            new Map([['u1', [{ category: 'account', in_app: true, email: false, sms: false }]]]),
        );
        await notificationService.notify({
            orgId: 'org-1', userIds: ['u1'], category: 'account', title: 'x',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        expect(repo.enqueueDeliveries).toHaveBeenCalledWith([]);
    });

    it('pairs the right notification id with each recipient even when rows come back reordered', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1', 'u2'],
            category: 'account',
            title: 'x',
            recipients: { u1: { email: 'one@b.com', phone: null }, u2: { email: 'two@b.com', phone: null } },
        });
        const enq = repo.enqueueDeliveries.mock.calls[0][0];
        const byAddr = Object.fromEntries(enq.map((d) => [d.to_address, d.notification_id]));
        // n0 was built for u1, n1 for u2 (mapping is by user_id, not row order).
        expect(byAddr['one@b.com']).toBe('n0');
        expect(byAddr['two@b.com']).toBe('n1');
    });

    it('deduplicates repeated user ids into a single in-app row', async () => {
        await notificationService.notify({
            orgId: 'org-1',
            userIds: ['u1', 'u1'],
            category: 'account',
            title: 'x',
            recipients: { u1: { email: 'a@b.com', phone: null } },
        });
        const insertedRows = repo.insertNotifications.mock.calls[0][0];
        expect(insertedRows).toHaveLength(1);
    });

    it('rejects a platform notify with no explicit recipients', async () => {
        await expect(
            notificationService.notify({ userIds: ['admin1'], isPlatform: true, category: 'account', title: 'x' }),
        ).rejects.toThrow(/recipients/);
    });
});
