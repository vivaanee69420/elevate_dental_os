"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Comms routes — Express Router. Mounted at /api/comms (auth upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const comm_controller_1 = require("../controllers/comm.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(comm_controller_1.commController.list));
router.post('/send', (0, async_handler_1.asyncHandler)(comm_controller_1.commController.send));
exports.default = router;
