// ============================================================================
// Daily Command Cockpit routes — mounted at /api/cockpit (authenticate + audit
// applied upstream in app.js). finance.view gate, same as business-hub —
// aggregates revenue/treatment/cash-up money (rule 5).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as cockpit_controller_1 from "../controllers/cockpit.controller.js";
const router = (0, express_1.Router)();
const fin = (0, auth_1.requirePermission)('finance.view');
const owner = (0, auth_1.requireRole)('owner');
// Lazy detail endpoints (fetched on drill-down open) — static paths, mounted
// before the root '/' handler (no param routes on this router, but keep the
// convention so future param routes can't shadow these).
router.get('/leads', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.leads));
router.get('/treatments', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.treatments));
router.get('/cashup-days', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.cashupDays));
router.get('/cost-model', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.costModel));
router.put('/cost-model/:practiceId', owner, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.saveCostModel));
router.get('/', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.cockpit));
export default router;
