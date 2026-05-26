// ============================================================================
// Associates routes — roster + Dentally-derived appointment stats.
// Mounted at /api/associates. Owner + practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { associateController } from "../controllers/associate.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(associateController.list));

export default router;
