// ============================================================================
// Plan4Growth AI routes — Express Router. Mounted at /api/p4g-ai (auth
// applied upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as p4g_ai_controller_1 from "../controllers/p4g-ai.controller.js";
const router = (0, express_1.Router)();
router.post('/chat', (0, async_handler_1.asyncHandler)(p4g_ai_controller_1.p4gAiController.chat));
export default router;
