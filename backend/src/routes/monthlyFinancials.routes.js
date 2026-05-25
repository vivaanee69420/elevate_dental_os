// ============================================================================
// Monthly financials routes — Express Router. Mounted at /api/monthly-financials
// (authenticate + audit applied upstream in app.js).
//
// RBAC: these are financial actuals. Gated on 'finance.view' — the same
// owner-toggled finance boundary the analytics routes use (project rule 5).
// Reception never holds finance.view → 403. Mutations are audited by the
// global audit middleware.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as monthlyFinancial_controller_1 from "../controllers/monthlyFinancial.controller.js";
const router = (0, express_1.Router)();
const fin = (0, auth_1.requirePermission)('finance.view');
router.get('/', fin, (0, async_handler_1.asyncHandler)(monthlyFinancial_controller_1.monthlyFinancialController.list));
router.post('/', fin, (0, async_handler_1.asyncHandler)(monthlyFinancial_controller_1.monthlyFinancialController.create));
router.delete('/:id', fin, (0, async_handler_1.asyncHandler)(monthlyFinancial_controller_1.monthlyFinancialController.remove));
export default router;
