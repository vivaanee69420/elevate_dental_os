// ============================================================================
// CRM template routes — Express Router. Mounted at /api/crm/templates.
// GET: any authenticated CRM user (Reception can view). Mutations: owner +
// practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { crmTemplateController } from "../controllers/crmTemplate.controller.js";

const router = (0, express_1.Router)();
const manage = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', (0, async_handler_1.asyncHandler)(crmTemplateController.list));
router.post('/', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.create));
router.patch('/:id', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.update));
router.delete('/:id', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.remove));

export default router;
