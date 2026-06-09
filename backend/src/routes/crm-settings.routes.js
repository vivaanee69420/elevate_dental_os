// ============================================================================
// CRM settings routes — Express Router. Mounted at /api/crm/settings.
// CRM Settings is a manage-only screen (Reception has no access), so both read
// and write are owner + practice_manager.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { crmSettingsController } from "../controllers/crmSettings.controller.js";

const router = (0, express_1.Router)();
const manage = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', manage, (0, async_handler_1.asyncHandler)(crmSettingsController.get));
router.put('/', manage, (0, async_handler_1.asyncHandler)(crmSettingsController.update));

export default router;
