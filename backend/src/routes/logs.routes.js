// ============================================================================
// Logs routes — Express Router. Mounted owner-gated at /api/admin/logs
// (requireRole('owner') applied at the mount point in app.js). Lets the owner
// read/download the production error + app logs written to LOG_DIR.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import { logsController } from "../controllers/logs.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(logsController.list));
router.get('/tail', (0, async_handler_1.asyncHandler)(logsController.tail));
router.get('/download', (0, async_handler_1.asyncHandler)(logsController.download));
export default router;
