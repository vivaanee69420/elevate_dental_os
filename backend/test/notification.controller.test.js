import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/notification.service.js', () => ({
    notificationService: {
        listInbox: vi.fn(async () => [{ id: 'n1', title: 'Hi' }]),
        unreadCount: vi.fn(async () => 3),
        markRead: vi.fn(async () => {}),
        markAllRead: vi.fn(async () => {}),
        getPreferences: vi.fn(async () => []),
        updatePreferences: vi.fn(async () => {}),
    },
}));

import { notificationController } from '../src/controllers/notification.controller.js';
import { notificationService } from '../src/services/notification.service.js';

function mockRes() {
    return { body: null, json(b) { this.body = b; return this; } };
}
beforeEach(() => vi.clearAllMocks());

describe('notificationController', () => {
    it('list scopes to the authenticated user id', async () => {
        const res = mockRes();
        await notificationController.list({ user: { id: 'u1' }, query: {} }, res);
        expect(notificationService.listInbox).toHaveBeenCalledWith('u1', expect.any(Object));
        expect(res.body).toEqual({ notifications: [{ id: 'n1', title: 'Hi' }] });
    });

    it('unreadCount returns the count for the user', async () => {
        const res = mockRes();
        await notificationController.unreadCount({ user: { id: 'u1' } }, res);
        expect(res.body).toEqual({ count: 3 });
    });

    it('updatePreferences validates the payload and passes user id', async () => {
        const res = mockRes();
        const body = { preferences: [{ category: 'account', in_app: true, email: false, sms: false }] };
        await notificationController.updatePreferences({ user: { id: 'u1' }, body }, res);
        expect(notificationService.updatePreferences).toHaveBeenCalledWith('u1', body.preferences);
        expect(res.body).toEqual({ ok: true });
    });

    it('updatePreferences rejects an unknown category', async () => {
        const res = mockRes();
        const body = { preferences: [{ category: 'nope', in_app: true, email: true, sms: true }] };
        await expect(
            notificationController.updatePreferences({ user: { id: 'u1' }, body }, res),
        ).rejects.toThrow();
    });
});
