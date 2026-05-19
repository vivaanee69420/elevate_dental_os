// ============================================================================
// Integrations routes — Express Router. Mounted at /api/integrations.
// All routes owner-only (requireRole('owner')). Static /connect before /:id.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as integration_controller_1 from "../controllers/integration.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.list));
router.post('/connect', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.connect));
router.delete('/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.remove));
export default router;
