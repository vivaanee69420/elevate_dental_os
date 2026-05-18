"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Reviews routes — Express Router. Mounted at /api/reviews.
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const review_controller_1 = require("../controllers/review.controller");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.list));
router.post('/:id/respond', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.respond));
exports.default = router;
