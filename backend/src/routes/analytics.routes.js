// ============================================================================
// Analytics routes — Express Router. Mounted at /api/analytics (auth upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as analytics_controller_1 from "../controllers/analytics.controller.js";
const router = (0, express_1.Router)();
router.get('/dashboard', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboard));
router.get('/pl', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.pl));
router.get('/valuation', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuation));
router.get('/kpis', (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.kpis));
export default router;
