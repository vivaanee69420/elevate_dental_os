// ============================================================================
// Billing routes — Express Router. Mounted at /api/billing (auth upstream).
// POST /portal is owner-only (enforced via requireRole).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as billing_controller_1 from "../controllers/billing.controller.js";
const router = (0, express_1.Router)();
// The subscription portal is Settings; system.manage is owner-only by default.
router.post('/portal', (0, auth_1.requirePermission)('system.manage'), (0, async_handler_1.asyncHandler)(billing_controller_1.billingController.portal));
export default router;
