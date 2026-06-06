// ============================================================================
// Task service — business logic for the tasks domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as task_repository_1 from "../repositories/task.repository.js";
import * as errors_1 from "../middleware/errors.js";
import { sendEmail } from "../lib/messaging.js";

// Compose the reminder email for one task and send it via the messaging
// facade (per-tenant SES if configured, else platform Postmark). Best-effort:
// a missing assignee email is a client-visible 400, a transport failure
// bubbles up. Owner cc is handled by passing the owner address when present.
async function sendTaskReminder(orgId, task, ownerEmail) {
    const to = task.assignee?.email;
    if (!to)
        throw new errors_1.AppError('Task assignee has no email address', 400);
    const due = task.due_date
        ? new Date(task.due_date).toLocaleDateString('en-GB')
        : 'no due date';
    const subject = `Reminder: ${task.title}`;
    const body =
        `This is a reminder about a task assigned to you.\n\n` +
        `Task: ${task.title}\n` +
        (task.description ? `Notes: ${task.description}\n` : '') +
        `Priority: ${task.priority}\n` +
        `Due: ${due}\n\n` +
        `Please update its status in the Task Manager.`;
    await sendEmail({ orgId, to, subject, body });
    if (ownerEmail && ownerEmail !== to)
        await sendEmail({ orgId, to: ownerEmail, subject: `[cc] ${subject}`, body });
    const { data, error } = await task_repository_1.taskRepository.bumpReminder(
        orgId,
        task.id,
        task.reminder_count,
    );
    if (error)
        throw new errors_1.AppError(error.message, 400);
    return data;
}

export const taskService = {
    list(orgId, q) {
        return task_repository_1.taskRepository.list(orgId, q);
    },
    async create(orgId, input) {
        const { data, error } = await task_repository_1.taskRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const body = { ...patch };
        if (body.status === 'done')
            body.completed_at = new Date().toISOString();
        const { data, error } = await task_repository_1.taskRepository.update(orgId, id, body);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async remove(orgId, id) {
        const { data, error } = await task_repository_1.taskRepository.remove(orgId, id);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        if (!data)
            throw new errors_1.AppError('Task not found', 404);
        return { ok: true };
    },
    // Send one reminder. ownerEmail (the actor) gets a cc for accountability.
    async remind(orgId, id, ownerEmail) {
        const { data: task, error } =
            await task_repository_1.taskRepository.getWithAssignee(orgId, id);
        if (error)
            throw new errors_1.AppError(error.message, 400);
        if (!task)
            throw new errors_1.AppError('Task not found', 404);
        return sendTaskReminder(orgId, task, ownerEmail);
    },
    // Bulk: remind every overdue task. Returns a per-task result so the UI can
    // report partial failures (e.g. an assignee with no email) without aborting
    // the whole batch.
    async remindOverdue(orgId, ownerEmail) {
        const overdue = await task_repository_1.taskRepository.listOverdue(orgId);
        const results = [];
        for (const task of overdue) {
            try {
                await sendTaskReminder(orgId, task, ownerEmail);
                results.push({ id: task.id, sent: true });
            } catch (err) {
                results.push({ id: task.id, sent: false, error: err.message });
            }
        }
        return { reminded: results.filter((r) => r.sent).length, total: overdue.length, results };
    },
};
