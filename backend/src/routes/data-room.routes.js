// backend/src/routes/data-room.routes.js
// ============================================================================
// Data Room routes — Express Router. Mounted at /api/data-room.
// Every route is gated on the `data.export` permission key (owner by
// default; the analyst role holds ONLY this key).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as features_1 from "../middleware/features.js";
import { dataRoomController } from "../controllers/data-room.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requirePermission)('data.export');

// Org entitlement first (agency model): the whole Data Room is an internal
// feature — org_features 'data_room', on only for agency orgs by default.
router.use((0, features_1.requireFeature)('data_room'));

// Static routes first — /:source/:dataset would otherwise swallow them.
router.get('/datasets', gate, (0, async_handler_1.asyncHandler)(dataRoomController.datasets));
router.get('/freshness', gate, (0, async_handler_1.asyncHandler)(dataRoomController.freshness));
router.get('/:source/:dataset/export.csv', gate, (0, async_handler_1.asyncHandler)(dataRoomController.exportCsv));
router.get('/:source/:dataset/export.xlsx', gate, (0, async_handler_1.asyncHandler)(dataRoomController.exportXlsx));
router.get('/:source/:dataset', gate, (0, async_handler_1.asyncHandler)(dataRoomController.page));

export default router;
