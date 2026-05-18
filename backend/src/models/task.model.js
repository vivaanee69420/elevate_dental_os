"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskUpdateSchema = exports.taskCreateSchema = exports.taskListQuerySchema = void 0;
// ============================================================================
// Task model — Zod schemas + inferred types for the tasks domain.
// ============================================================================
const zod_1 = require("zod");
exports.taskListQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
});
exports.taskCreateSchema = zod_1.z.object({
    title: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
    due_date: zod_1.z.string().optional(),
    priority: zod_1.z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    related_lead_id: zod_1.z.string().uuid().optional(),
    related_contact_id: zod_1.z.string().uuid().optional(),
});
exports.taskUpdateSchema = zod_1.z.record(zod_1.z.any());
