// ============================================================================
// Treatment routes — appointment-derived treatment mix (volume).
// Mounted at /api/treatments. Owner + practice_manager only (matches roster).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { treatmentController } from "../controllers/treatment.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(treatmentController.mix));

export default router;
