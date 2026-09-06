// ============================================================================
// Ad attribution routes — Express Router. Mounted at /api/ad-attribution
// (auth applied upstream). Static paths registered before any param route.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { requireAgencyActor, requireOwnerOrAgencyActor } from "../middleware/agency.js";
import { adAttributionController } from "../controllers/ad-attribution.controller.js";
const router = (0, express_1.Router)();

const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/config', gate, (0, async_handler_1.asyncHandler)(adAttributionController.config));
router.get('/performance', gate, (0, async_handler_1.asyncHandler)(adAttributionController.performance));
router.get('/leads', gate, (0, async_handler_1.asyncHandler)(adAttributionController.leads));
router.get('/mapping-health', gate, (0, async_handler_1.asyncHandler)(adAttributionController.mappingHealth));
router.get('/spend', gate, (0, async_handler_1.asyncHandler)(adAttributionController.spend));
// Mapping MUTATIONS are agency-actor powers (A2); the reads above stay open
// to owner/PM — marketing dashboards consume them.
//
// Pipeline-channel is the one exception: a tenant owner categorising their
// own pipeline (e.g. for an open day) shouldn't have to wait on their agency,
// so it's owner-OR-agency-actor. Subaccount/ad-account mapping stay
// agency-actor only — those decide how an agency's client data is attributed.
router.put('/pipelines/:accountId/:pipelineId', gate, requireOwnerOrAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setPipelineChannel));
router.patch('/subaccounts/:id', gate, requireAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setSubaccountPractice));
router.patch('/ad-accounts/:id', gate, requireAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setAdAccountPractice));

export default router;
