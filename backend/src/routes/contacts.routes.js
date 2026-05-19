// ============================================================================
// Contacts routes — Express Router. Mounted at /api/contacts (auth upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as contact_controller_1 from "../controllers/contact.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.list));
router.get('/:id', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.getById));
router.post('/', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(contact_controller_1.contactController.update));
export default router;
