
// ============================================================================
// Permissions routes — mounted at /api/admin/permissions (behind the global
// /api authenticate + audit middleware). Every route additionally requires
// the dynamic 'permissions.manage' capability, so only roles the owner has
// granted matrix-editing can touch it. GET is gated too: the matrix reveals
// the org's whole access model.
// ============================================================================

import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { permissionsController } from "../controllers/permissions.controller.js";

const router = Router();

router.use(requirePermission('permissions.manage'));

router.get('/', asyncHandler(permissionsController.getMatrix));
router.put('/role', asyncHandler(permissionsController.setRoleDefault));
router.put('/user', asyncHandler(permissionsController.setUserOverride));

export default router;
