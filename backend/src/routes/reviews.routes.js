// ============================================================================
// Reviews routes — Express Router. Mounted at /api/reviews.
// Read paths are open to any authenticated tenant user; source management +
// sync are owner-only (they touch integration config). Static paths first.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as review_controller_1 from "../controllers/review.controller.js";
const router = (0, express_1.Router)();

// Feed + summary (filterable via ?source= & ?practice_id=).
router.get('/', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.list));

// Source ("account") management — the place/page picker + selection.
router.get('/sources', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.sources));
router.get('/sources/search', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.search));
router.post('/sources/selection', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.setSelection));
router.post('/sources', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.addSource));
router.patch('/sources/:id/practice', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.setSourcePractice));
router.delete('/sources/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.removeSource));

// Sync.
router.post('/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.sync));
router.get('/sync-progress', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.syncProgress));

// Respond to a single review (records internally; Google/Facebook are read-only).
router.post('/:id/respond', (0, async_handler_1.asyncHandler)(review_controller_1.reviewController.respond));

export default router;
