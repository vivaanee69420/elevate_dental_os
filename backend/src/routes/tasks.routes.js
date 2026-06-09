// ============================================================================
// Tasks routes — Express Router. Mounted at /api/tasks (auth upstream).
//
// Read is open to every authenticated role; ALL mutations are Owner-only
// (requireRole('owner')) — "only admin can add tasks, others can only see".
// The UI also hides write controls for non-owners, but THIS is the boundary.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as task_controller_1 from "../controllers/task.controller.js";
const router = (0, express_1.Router)();

const ownerOnly = auth_1.requireRole('owner');

router.get('/', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.list));
router.post('/', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.create));
router.post('/remind-overdue', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.remindOverdue));
router.post('/generate-ai', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.generateAiTasks));
router.patch('/:id', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.update));
router.delete('/:id', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.remove));
router.post('/:id/remind', ownerOnly, (0, async_handler_1.asyncHandler)(task_controller_1.taskController.remind));
export default router;
