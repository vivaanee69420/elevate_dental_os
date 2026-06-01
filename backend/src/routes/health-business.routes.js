// ============================================================================
// Business Health routes — Express Router. Mounted at /api/health (auth
// applied upstream). Static paths registered before any param routes.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as business_health_controller_1 from "../controllers/business-health.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.get));
router.put('/', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.update));
router.get('/insights', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.insights));
router.get('/snapshots', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.listSnapshots));
router.post('/snapshots', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.createSnapshot));
router.get('/progress', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.progress));
router.get('/metrics', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.metrics));
router.patch('/metrics/:key', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.updateMetric));
router.patch('/cadence', (0, async_handler_1.asyncHandler)(business_health_controller_1.businessHealthController.updateCadence));
export default router;
