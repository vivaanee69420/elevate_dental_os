"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Contacts routes — Express Router. Mounted at /api/contacts (auth upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const contact_controller_1 = require("../controllers/contact.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.list));
router.get('/:id', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.getById));
router.post('/', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.update));
exports.default = router;
