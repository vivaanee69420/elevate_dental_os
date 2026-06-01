// ============================================================================
// Workflows routes — Express Router. Mounted at /api/workflows.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as workflow_controller_1 from "../controllers/workflow.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.list));
router.get('/ghl', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.ghl));
router.post('/', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.update));
router.delete('/:id', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.remove));
export default router;
