// ============================================================================
// Ad attribution routes — Express Router. Mounted at /api/ad-attribution
// (auth applied upstream). Static paths registered before any param route.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { adAttributionController } from "../controllers/ad-attribution.controller.js";
const router = (0, express_1.Router)();

const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/config', gate, (0, async_handler_1.asyncHandler)(adAttributionController.config));
router.get('/performance', gate, (0, async_handler_1.asyncHandler)(adAttributionController.performance));
router.get('/leads', gate, (0, async_handler_1.asyncHandler)(adAttributionController.leads));
router.get('/mapping-health', gate, (0, async_handler_1.asyncHandler)(adAttributionController.mappingHealth));
router.get('/spend', gate, (0, async_handler_1.asyncHandler)(adAttributionController.spend));
router.put('/pipelines/:accountId/:pipelineId', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setPipelineChannel));
router.patch('/subaccounts/:id', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setSubaccountPractice));
router.patch('/ad-accounts/:id', gate, (0, async_handler_1.asyncHandler)(adAttributionController.setAdAccountPractice));

export default router;
