// ============================================================================
// Integrations routes — Express Router. Mounted at /api/integrations.
// Owner-only RBAC. Static paths before param routes.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as integration_controller_1 from "../controllers/integration.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.list));
router.post('/connect', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.connect));
router.get('/:provider/callback', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callback));
router.post('/:provider/callback', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callback));
router.post('/:provider/refresh', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.refresh));
router.post('/:provider/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.sync));
router.get('/:provider/site-ids', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.siteIds));
router.get('/:provider/pipelines', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.pipelines));
router.post('/:provider/stage-mappings', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setStageMappings));
router.get('/:provider/sync-progress', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.syncProgress));
router.get('/:provider/webhook-info', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.webhookInfo));
router.post('/:provider/webhook-secret', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setWebhookSecret));
router.post('/:provider/revoke', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.revoke));
router.get('/:provider/ad-accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.adAccounts));
router.post('/:provider/ad-accounts/selection', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setAdAccountSelection));
router.delete('/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.remove));
export default router;
