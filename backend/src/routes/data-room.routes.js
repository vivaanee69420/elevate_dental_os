// backend/src/routes/data-room.routes.js
// ============================================================================
// Data Room routes — Express Router. Mounted at /api/data-room.
// Every route is gated on the `data.export` permission key (owner by
// default; the analyst role holds ONLY this key).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { dataRoomController } from "../controllers/data-room.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requirePermission)('data.export');

router.get('/datasets', gate, (0, async_handler_1.asyncHandler)(dataRoomController.datasets));
router.get('/:source/:dataset/export.csv', gate, (0, async_handler_1.asyncHandler)(dataRoomController.exportCsv));
router.get('/:source/:dataset', gate, (0, async_handler_1.asyncHandler)(dataRoomController.page));

export default router;
