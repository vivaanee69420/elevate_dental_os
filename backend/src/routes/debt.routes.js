// ============================================================================
// Debt routes — Express Router. Mounted at /api/debt (auth + audit upstream).
// No route-level role gate — matches payments.routes.js. Finance/Reception
// visibility is enforced at the frontend nav layer.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as debt_controller_1 from "../controllers/debt.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(debt_controller_1.debtController.list));
export default router;
