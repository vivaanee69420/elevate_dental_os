"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Leads routes — Express Router. Mounted at /api/leads (auth applied upstream).
// NOTE: static paths (/funnel) registered before /:id so they don't get
// swallowed by the param route.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const lead_controller_1 = require("../controllers/lead.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.list));
router.get('/funnel', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.funnel));
router.get('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.getById));
router.post('/', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.update));
router.delete('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.remove));
exports.default = router;
