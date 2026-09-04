// ============================================================================
// Pay-runs routes — Express Router. Mounted at /api/pay-runs (auth upstream).
// Owner-only by default, but expressed as the `payrun.manage` PERMISSION rather
// than a hardcoded role. Same people get in (owner holds every key, no other
// role holds this one) — the difference is that payroll is now a row in the
// Team Permissions matrix, so the nav can hide it from anyone who lacks it
// instead of showing a Pay Runs tab that 403s, and an owner can delegate it.
// Static paths registered before the /:id param route.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as pay_run_controller_1 from "../controllers/pay-run.controller.js";
const router = (0, express_1.Router)();
router.use((0, auth_1.requirePermission)('payrun.manage'));
router.get('/', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.list));
router.get('/draft', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.draft));
router.post('/calculate', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.calculate));
router.post('/:id/approve', (0, async_handler_1.asyncHandler)(pay_run_controller_1.payRunController.approve));
export default router;
