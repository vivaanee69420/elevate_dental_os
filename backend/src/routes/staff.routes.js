// ============================================================================
// Staff routes — team roster (Dentally `/users`-derived).
// Mounted at /api/staff. Owner + practice_manager only (matches staff RLS).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { staffController } from "../controllers/staff.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(staffController.list));

export default router;
