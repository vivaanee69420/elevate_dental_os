// ============================================================================
// Appointments routes — Express Router. Mounted at /api/appointments.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as appointment_controller_1 from "../controllers/appointment.controller.js";
const router = (0, express_1.Router)();
// This was the ONLY route in the Operations section with no user-level gate:
// the nav hid the page from anyone without operations.view, but the API served
// every authenticated user who typed the URL — including reception, which is
// CRM-only (rule 5). Gating on the permission key rather than a role list also
// makes the Team Permissions matrix real in both directions: a grant works, and
// a revoke actually takes effect.
const gate = (0, auth_1.requirePermission)('operations.view');
router.get('/', gate, (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.list));
router.post('/', gate, (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.create));
router.patch('/:id', gate, (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.update));
export default router;
