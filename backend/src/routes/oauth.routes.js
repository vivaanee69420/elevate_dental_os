// ============================================================================
// Public OAuth callback routes — mounted at /oauth (NO auth middleware).
// ============================================================================
// OAuth providers redirect the user's browser back here after consent. That
// redirect carries no Bearer token, so this router sits OUTSIDE /api's
// `authenticate` gate (same tier as /webhooks). The org is recovered from the
// HMAC-signed `state` param inside the controller — see integration.controller
// .oauthCallback + lib/oauth-state.js.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as integration_controller_1 from "../controllers/integration.controller.js";
const router = (0, express_1.Router)();
router.get('/:provider/callback', (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.oauthCallback));
export default router;
