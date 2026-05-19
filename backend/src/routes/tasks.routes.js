// ============================================================================
// Tasks routes — Express Router. Mounted at /api/tasks (auth upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as task_controller_1 from "../controllers/task.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.list));
router.post('/', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.update));
export default router;
