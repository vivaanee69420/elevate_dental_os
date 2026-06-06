// ============================================================================
// Notification controller — parse Zod, call service, shape HTTP. No logic.
// ============================================================================
import { notificationService } from "../services/notification.service.js";
import * as notification_model_1 from "../models/notification.model.js";
import { idParamSchema } from "../models/common.model.js";

export const notificationController = {
    async list(req, res) {
        const q = notification_model_1.notificationListQuerySchema.parse(req.query);
        const rows = await notificationService.listInbox(req.user.id, q);
        res.json({ notifications: rows });
    },
    async unreadCount(req, res) {
        const count = await notificationService.unreadCount(req.user.id);
        res.json({ count });
    },
    async markRead(req, res) {
        const { id } = idParamSchema.parse(req.params);
        await notificationService.markRead(req.user.id, id);
        res.json({ ok: true });
    },
    async markAllRead(req, res) {
        await notificationService.markAllRead(req.user.id);
        res.json({ ok: true });
    },
    async getPreferences(req, res) {
        const rows = await notificationService.getPreferences(req.user.id);
        res.json({ preferences: rows });
    },
    async updatePreferences(req, res) {
        const { preferences } = notification_model_1.preferencesUpdateSchema.parse(req.body);
        await notificationService.updatePreferences(req.user.id, preferences);
        res.json({ ok: true });
    },
};
