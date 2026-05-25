
// ============================================================================
// Permissions routes — mounted at /api/admin/permissions (behind the global
// /api authenticate + audit middleware). OWNER-ONLY: matrix editing mutates
// users.permissions / role_permissions, which sit at the HIGHEST precedence
// in resolveEffectivePermissions. Delegating this via the dynamic
// 'permissions.manage' key was a privilege-escalation hole — a non-owner
// holding the key could self-grant any permission or strip the owner. Gate
// on the built-in owner role so the grant ceiling cannot be side-stepped.
// (The 'permissions.manage' catalog key is therefore effectively owner-only.)
// ============================================================================

import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireRole } from "../middleware/auth.js";
import { permissionsController } from "../controllers/permissions.controller.js";

const router = Router();

router.use(requireRole('owner'));

router.get('/', asyncHandler(permissionsController.getMatrix));
router.put('/role', asyncHandler(permissionsController.setRoleDefault));
router.put('/user', asyncHandler(permissionsController.setUserOverride));

export default router;
