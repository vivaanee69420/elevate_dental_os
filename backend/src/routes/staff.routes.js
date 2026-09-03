// ============================================================================
// Staff routes — team roster (Dentally `/users`-derived).
// Mounted at /api/staff. Owner + practice_manager only (matches staff RLS).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { staffController } from "../controllers/staff.controller.js";

const router = (0, express_1.Router)();
// Gated on the `operations.view` PERMISSION, not on a role list. A role list
// makes the Team Permissions matrix decorative: granting operations.view to
// another role (the analyst) did nothing, and revoking it from a practice
// manager was silently ignored. owner + practice_manager hold the key by
// default in every org, so this is behaviour-preserving for them.
const gate = (0, auth_1.requirePermission)('operations.view');

router.get('/', gate, (0, async_handler_1.asyncHandler)(staffController.list));

export default router;
