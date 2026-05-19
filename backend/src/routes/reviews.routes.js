// ============================================================================
// Reviews routes — Express Router. Mounted at /api/reviews.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as review_controller_1 from "../controllers/review.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.list));
router.post('/:id/respond', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.respond));
export default router;
