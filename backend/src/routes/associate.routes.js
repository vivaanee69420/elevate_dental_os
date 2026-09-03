// ============================================================================
// Associates routes — roster + Dentally-derived appointment stats.
// Mounted at /api/associates. Gated on the operations.view permission.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { associateController } from "../controllers/associate.controller.js";

const router = (0, express_1.Router)();
// Gated on the `operations.view` PERMISSION, not on a role list. A role list
// makes the Team Permissions matrix decorative: granting operations.view to
// another role (the analyst) did nothing, and revoking it from a practice
// manager was silently ignored. owner + practice_manager hold the key by
// default in every org, so this is behaviour-preserving for them.
const gate = (0, auth_1.requirePermission)('operations.view');

router.get('/', gate, (0, async_handler_1.asyncHandler)(associateController.list));

export default router;
