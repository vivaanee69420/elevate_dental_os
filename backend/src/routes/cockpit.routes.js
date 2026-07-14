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
router.get('/', fin, (0, async_handler_1.asyncHandler)(cockpit_controller_1.cockpitController.cockpit));
export default router;
