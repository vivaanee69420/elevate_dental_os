// ============================================================================
// Chair utilisation routes — manual utilisation CRUD + heatmap grid.
// Mounted at /api/chair-utilisation. Owner + practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { chairUtilisationController } from "../controllers/chair-utilisation.controller.js";

const router = (0, express_1.Router)();
const gate = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.list));
router.get('/grid', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.grid));
router.post('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.create));
router.patch('/:id', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.update));
router.delete('/:id', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.remove));

export default router;
