// ============================================================================
// Call Reporting routes — Express Router. Mounted at /api/call-reporting.
// Dashboard read for owner + practice manager (Reception stays CRM-only,
// project rule 5).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as features_1 from "../middleware/features.js";
import { sheetsController } from "../controllers/sheets.controller.js";
const router = (0, express_1.Router)();
router.use((0, features_1.requireFeature)('call_reporting'));
router.get('/dashboard', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetsController.dashboard));
export default router;
