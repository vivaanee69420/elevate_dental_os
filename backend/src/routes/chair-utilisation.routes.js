// ============================================================================
// Chair utilisation routes — chairs, opening hours, and the week grid.
// Mounted at /api/chair-utilisation.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { requirePermissionOrAgencyActor } from "../middleware/agency.js";
import { chairUtilisationController } from "../controllers/chair-utilisation.controller.js";
import { practitionerUtilisationController } from "../controllers/practitioner-utilisation.controller.js";

const router = (0, express_1.Router)();
// Gated on the `operations.view` PERMISSION, not on a role list. A role list
// makes the Team Permissions matrix decorative: granting operations.view to
// another role (the analyst) did nothing, and revoking it from a practice
// manager was silently ignored. owner + practice_manager hold the key by
// default in every org, so this is behaviour-preserving for them.
const gate = (0, auth_1.requirePermission)('operations.view');

// Reading operations data and REWRITING it are different powers. Until
// operations.edit existed, operations.view granted both, so anyone who could
// read a practice's chair grid could also overwrite its whole week.
//
// Writes take operations.edit OR agency-actor status, because chair
// utilisation is a BOTH feature: the sub-account's own owner or practice
// manager maintains it, and an agency actor switched in may edit it too.
const gateEdit = requirePermissionOrAgencyActor('operations.edit');

router.get('/', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.list));
router.get('/grid', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.grid));

router.get('/week', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.week));
router.put('/week', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.saveWeek));

router.get('/chairs', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.listChairs));
router.post('/chairs', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.createChair));
router.patch('/chairs/:id', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.updateChair));
router.delete('/chairs/:id', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.removeChair));

// Practitioner utilisation — derived entirely from the synced diary, so it is
// a READ with no entry counterpart. Same `operations.view` gate as the rest of
// this router: the people who maintain the chair grid are the people who need
// to see who is filling their chairs.
router.get('/practitioners', gate, (0, async_handler_1.asyncHandler)(practitionerUtilisationController.overview));

router.get('/opening-hours', gate, (0, async_handler_1.asyncHandler)(chairUtilisationController.openingHours));
router.put('/opening-hours', gateEdit, (0, async_handler_1.asyncHandler)(chairUtilisationController.saveOpeningHours));

export default router;
