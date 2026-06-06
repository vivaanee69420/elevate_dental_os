// ============================================================================
// Notification model — Zod schemas for the notifications domain.
// ============================================================================
import * as zod_1 from "zod";

export const NOTIFICATION_CATEGORIES = ['account', 'team', 'integration', 'digest', 'system'];

export const notificationListQuerySchema = zod_1.z.object({
    unread: zod_1.z.coerce.boolean().optional(),
    limit: zod_1.z.coerce.number().min(1).max(100).default(50),
});

// One category row in the preferences PUT payload.
const prefRowSchema = zod_1.z.object({
    category: zod_1.z.enum(['account', 'team', 'integration', 'digest', 'system']),
    in_app: zod_1.z.boolean(),
    email: zod_1.z.boolean(),
    sms: zod_1.z.boolean(),
});

export const preferencesUpdateSchema = zod_1.z.object({
    preferences: zod_1.z.array(prefRowSchema).min(1),
});

// Internal — validates inputs to notify(). Not bound to an HTTP route.
export const notifyInputSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid().nullable().optional(),
    userIds: zod_1.z.array(zod_1.z.string().uuid()).min(1),
    isPlatform: zod_1.z.boolean().default(false),
    category: zod_1.z.enum(['account', 'team', 'integration', 'digest', 'system']),
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().optional(),
    link: zod_1.z.string().optional(),
});
