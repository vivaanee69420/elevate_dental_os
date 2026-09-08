// ============================================================================
// Call Reporting routes — Express Router. Mounted at /api/call-reporting.
//
// Gated on growth.view — the SAME key its nav item uses (ROUTE_PERMISSION
// 'call-reporting'). It was a role list, and section-lock.js recorded that as
// a "real mismatch, left for its own change": the nav showed the tab to
// anyone holding growth.view, and the API then answered "Insufficient
// permissions" to everyone outside the two named roles. An owner who granted
// the tab to an analyst got a page that rendered and immediately failed.
//
// Reception still cannot reach it (crm.view only, project rule 5), and a
// practice manager holds growth.view by default, so nobody loses access.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as features_1 from "../middleware/features.js";
import { sheetsController } from "../controllers/sheets.controller.js";
const router = (0, express_1.Router)();
router.use((0, features_1.requireFeature)('call_reporting'));
router.get('/dashboard', (0, auth_1.requirePermission)('growth.view'), (0, async_handler_1.asyncHandler)(sheetsController.dashboard));
export default router;
