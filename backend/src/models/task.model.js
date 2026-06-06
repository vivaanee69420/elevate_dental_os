// ============================================================================
// Task model — Zod schemas + inferred types for the tasks domain.
// ============================================================================
import * as zod_1 from "zod";
export const taskListQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
});
export const taskCreateSchema = zod_1.z.object({
    title: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    assigned_to: zod_1.z.string().uuid().optional(),
    due_date: zod_1.z.string().optional(),
    priority: zod_1.z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    related_lead_id: zod_1.z.string().uuid().optional(),
    related_contact_id: zod_1.z.string().uuid().optional(),
});
// Bounded partial — only these fields may be patched (was z.record(any), an
// unbounded write surface). status='done' side-effects completed_at in the
// service. assigned_to nullable so a task can be unassigned.
export const taskUpdateSchema = zod_1.z
    .object({
        title: zod_1.z.string().min(1),
        description: zod_1.z.string().nullable(),
        assigned_to: zod_1.z.string().uuid().nullable(),
        due_date: zod_1.z.string().nullable(),
        priority: zod_1.z.enum(['low', 'normal', 'high', 'urgent']),
        status: zod_1.z.enum(['open', 'in_progress', 'done', 'cancelled']),
    })
    .partial();
