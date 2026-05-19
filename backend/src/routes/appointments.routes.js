// ============================================================================
// Appointments routes — Express Router. Mounted at /api/appointments.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as appointment_controller_1 from "../controllers/appointment.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.list));
router.post('/', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.update));
export default router;
