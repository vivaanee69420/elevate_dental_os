"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Appointments routes — Express Router. Mounted at /api/appointments.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const appointment_controller_1 = require("../controllers/appointment.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.list));
router.post('/', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(appointment_controller_1.appointmentController.update));
exports.default = router;
