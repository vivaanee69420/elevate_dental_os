// ============================================================================
// Health routes — Express Router. Mounted PUBLIC at /healthcheck (no auth).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as health_controller_1 from "../controllers/health.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(health_controller_1.healthController.check));
export default router;
