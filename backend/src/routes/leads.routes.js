// ============================================================================
// Leads routes — Express Router. Mounted at /api/leads (auth applied upstream).
// NOTE: static paths (/funnel, /report) registered before /:id so they don't get
// swallowed by the param route.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as lead_controller_1 from "../controllers/lead.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.list));
router.get('/funnel', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.funnel));
router.get('/report', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.report));
router.get('/pipelines', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.pipelines));
// Exporting raw lead/contact data off the board is a bigger act than viewing
// it, so this is gated on `data.export` — NOT `crm.view`. Reception (CRM view
// only, rule 5) can see the Pipeline board but cannot export it. Registered
// before `/:id` so it isn't swallowed by the param route.
router.get('/export.csv', (0, auth_1.requirePermission)('data.export'), (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.exportCsv));
router.get('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.getById));
router.post('/', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.create));
router.patch('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.update));
router.delete('/:id', (0, async_handler_1.asyncHandler)(lead_controller_1.leadController.remove));
export default router;
