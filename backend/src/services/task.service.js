// ============================================================================
// Task service — business logic for the tasks domain.
// Orchestrates the repository; throws AppError for client-visible failures.
// ============================================================================
import * as task_repository_1 from "../repositories/task.repository.js";
import * as errors_1 from "../middleware/errors.js";
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
};
