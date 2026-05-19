import * as task_service_1 from "../services/task.service.js";
import * as task_model_1 from "../models/task.model.js";
export const taskController = {
    async list(req, res) {
        const q = task_model_1.taskListQuerySchema.parse(req.query);
        const tasks = await task_service_1.taskService.list(req.user.organisation_id, q);
        res.json({ tasks });
    },
    async create(req, res) {
        const body = task_model_1.taskCreateSchema.parse(req.body);
        res.json(await task_service_1.taskService.create(req.user.organisation_id, body));
    },
    async update(req, res) {
        const body = task_model_1.taskUpdateSchema.parse(req.body);
        res.json(await task_service_1.taskService.update(req.user.organisation_id, req.params.id, body));
    },
};
