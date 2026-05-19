// ============================================================================
// Files routes — Express Router. Mounted at /api/files.
// Static /presign registered before / (both POST/GET distinct, no conflict).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as file_controller_1 from "../controllers/file.controller.js";
const router = (0, express_1.Router)();
router.post('/presign', (0, async_handler_1.asyncHandler)(file_controller_1.fileController.presign));
router.get('/', (0, async_handler_1.asyncHandler)(file_controller_1.fileController.list));
export default router;
