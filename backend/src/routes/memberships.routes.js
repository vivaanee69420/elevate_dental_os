// ============================================================================
// Memberships routes — Express Router. Mounted at /api/memberships.
// Static /plans registered before / so it isn't shadowed.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as membership_controller_1 from "../controllers/membership.controller.js";
const router = (0, express_1.Router)();
router.get('/plans', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.listPlans));
router.get('/', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.list));
router.post('/', (0, async_handler_1.asyncHandler)(membership_controller_1.membershipController.create));
export default router;
