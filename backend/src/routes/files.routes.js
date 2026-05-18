"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Files routes — Express Router. Mounted at /api/files.
// Static /presign registered before / (both POST/GET distinct, no conflict).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const file_controller_1 = require("../controllers/file.controller");
const router = (0, express_1.Router)();
router.post('/presign', (0, async_handler_1.asyncHandler)(file_controller_1.fileController.presign));
router.get('/', (0, async_handler_1.asyncHandler)(file_controller_1.fileController.list));
exports.default = router;
