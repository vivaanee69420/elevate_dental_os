// ============================================================================
// Finance > QuickBooks routes — Express Router. Mounted at /api/finance/quickbooks
// (authenticate + audit applied upstream in app.js). Gated on 'finance.view'
// (project rule 5: the owner-toggled finance boundary; Reception never holds it).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { financeQuickbooksController } from "../controllers/finance-quickbooks.controller.js";
const router = (0, express_1.Router)();
const fin = (0, auth_1.requirePermission)('finance.view');
router.get('/', fin, (0, async_handler_1.asyncHandler)(financeQuickbooksController.overview));
export default router;
