"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Plan4Growth AI routes — Express Router. Mounted at /api/p4g-ai (auth
// applied upstream).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const p4g_ai_controller_1 = require("../controllers/p4g-ai.controller");
const router = (0, express_1.Router)();
router.post('/chat', (0, async_handler_1.asyncHandler)(p4g_ai_controller_1.p4gAiController.chat));
exports.default = router;
