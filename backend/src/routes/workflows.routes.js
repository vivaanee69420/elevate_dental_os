"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Workflows routes — Express Router. Mounted at /api/workflows.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const workflow_controller_1 = require("../controllers/workflow.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.list));
router.post('/', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.update));
router.delete('/:id', (0, async_handler_1.asyncHandler)(workflow_controller_1.workflowController.remove));
exports.default = router;
