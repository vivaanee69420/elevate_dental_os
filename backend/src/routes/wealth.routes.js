// ============================================================================
// Wealth routes — personal-wealth Exit Plan / FIRE (DentaCFO gap Phase 4).
// The Wealth section is OWNER-ONLY (rule 5 / nav ownerOnly). Reads are gated on
// the wealth.view permission (an owner may toggle it to a Practice Manager);
// writes (the persisted personal balance sheet) are owner-only. The /compute/
// endpoints are pure recompute (slider-driven) and audit-exempt, mirroring the
// analytics /compute/ pattern. Data persists in wealth_inputs (migration
// 000061); the business sale value is read live from the valuation midpoint.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as wealth_controller_1 from "../controllers/wealth.controller.js";

const router = (0, express_1.Router)();
const view = (0, auth_1.requirePermission)('wealth.view');
const owner = (0, auth_1.requireRole)('owner');

// Persisted personal-wealth inputs.
router.get('/inputs', view, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.getInputs));
router.put('/inputs', owner, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.saveInputs));

// Assembled live views.
router.get('/net', view, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.netWorth));
router.get('/fire', view, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.exitPlan));

// Pure recompute (audit-exempt slider endpoints).
router.post('/compute/sale-waterfall', view, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.saleWaterfall));
router.post('/compute/fire', view, (0, async_handler_1.asyncHandler)(wealth_controller_1.wealthController.firePlan));

export default router;
