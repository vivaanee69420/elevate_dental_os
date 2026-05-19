// ============================================================================
// Comms routes — Express Router. Mounted at /api/comms (auth upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as comm_controller_1 from "../controllers/comm.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(comm_controller_1.commController.list));
router.post('/send', (0, async_handler_1.asyncHandler)(comm_controller_1.commController.send));
export default router;
