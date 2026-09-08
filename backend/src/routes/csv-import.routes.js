// CSV manual-feed routes — staged upload + dual-approval import.
// Owner / practice_manager only (finance governance). Mounted at /api/imports.
//
//   POST   /            upload + validate + stage a CSV (returns row-level rejects)
//   GET    /            list batches for the org
//   GET    /:id         batch detail + staged rows
//   POST   /:id/approve approve (uploader != approver enforced server-side -> 403)
//   POST   /:id/reject  reject a pending batch

import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { csvImportController } from "../controllers/csv-import.controller.js";

const router = (0, express_1.Router)();
// system.manage — the key the Data Hub / Imports nav item uses. A practice
// manager has no route to this screen, so aligning the API with the nav is the
// point rather than a side effect: it was reachable by URL to a role the
// matrix never granted it to.
const gate = (0, auth_1.requirePermission)('system.manage');

router.post('/', gate, (0, async_handler_1.asyncHandler)(csvImportController.upload));
router.get('/', gate, (0, async_handler_1.asyncHandler)(csvImportController.list));
router.get('/:id', gate, (0, async_handler_1.asyncHandler)(csvImportController.detail));
router.post('/:id/approve', gate, (0, async_handler_1.asyncHandler)(csvImportController.approve));
router.post('/:id/reject', gate, (0, async_handler_1.asyncHandler)(csvImportController.reject));

export default router;
