// ============================================================================
// Tax routes.
//
// READS are finance.view: tax is financial data, and Reception is CRM-only
// (project rule 5), so the same key that gates P&L and cash flow gates this.
// WRITES are owner-only: entity type and VAT liability are declarations about
// the business that carry real consequence, and a practice manager with
// finance access should not be able to change what regime the company is in.
// ============================================================================
import * as express_1 from "express";
import * as auth_1 from "../middleware/auth.js";
import * as async_handler_1 from "../middleware/async-handler.js";
import { taxController } from "../controllers/tax.controller.js";

const router = express_1.Router();

const view = (0, auth_1.requirePermission)('finance.view');
// tax.manage — entity type and VAT liability are declarations about the
// business, so they keep their own key rather than riding on intelligence.view.
// Owner-only by default.
const owner = (0, auth_1.requirePermission)('tax.manage');

router.get('/overview', view, (0, async_handler_1.asyncHandler)(taxController.overview));
router.get('/settings', view, (0, async_handler_1.asyncHandler)(taxController.settings));
router.put('/settings', owner, (0, async_handler_1.asyncHandler)(taxController.saveSettings));
router.get('/treatments', view, (0, async_handler_1.asyncHandler)(taxController.treatments));
router.put('/treatments/liability', owner, (0, async_handler_1.asyncHandler)(taxController.setLiability));

export default router;
