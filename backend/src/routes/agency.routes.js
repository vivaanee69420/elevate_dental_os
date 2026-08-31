// ============================================================================
// Agency menu routes — Express Router. Mounted at /api/agency (auth + audit
// applied upstream). ALL routes require an agency owner; handlers act on the
// caller's HOME org, so the menu keeps working while switched into a child.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import { requireAgencyOwner } from "../middleware/agency.js";
import { agencyController } from "../controllers/agency.controller.js";

const router = (0, express_1.Router)();

router.get('/subaccounts', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.list));
router.post('/subaccounts', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.create));
router.get('/subaccounts/:id/features', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.features));
router.patch('/subaccounts/:id/features', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.setFeature));
router.post('/switch', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.switch));

export default router;
