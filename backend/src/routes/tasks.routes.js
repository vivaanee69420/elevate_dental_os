"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Tasks routes — Express Router. Mounted at /api/tasks (auth upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const task_controller_1 = require("../controllers/task.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.list));
router.post('/', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(task_controller_1.taskController.update));
exports.default = router;
