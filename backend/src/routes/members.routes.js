// ============================================================================
// Team routes — mounted /api/admin/team behind global authenticate + audit.
// list/invite require 'users.invite'; remove requires 'users.manage'
// (dynamic RBAC — only roles the owner has granted these can manage the team).
// ============================================================================

import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission, requireRole } from "../middleware/auth.js";
import { membersController } from "../controllers/members.controller.js";

const router = Router();

router.get("/", requirePermission("users.invite"), asyncHandler(membersController.list));
// Creates a login AND writes its user_organisations row(s) in one call, the
// same users.permissions-adjacent territory as the :id editor below — owner
// only, not delegable via a permission key.
router.post("/", requireRole('owner'), asyncHandler(membersController.create));
router.post("/invite", requirePermission("users.invite"), asyncHandler(membersController.invite));
// Setting a password is account-takeover-grade — gate on the stronger
// users.manage (same as remove), not users.invite. Role-hierarchy + grant
// ceiling are enforced in the service.
router.post("/provision", requirePermission("users.manage"), asyncHandler(membersController.provision));
router.post("/password", requirePermission("users.manage"), asyncHandler(membersController.setPassword));
router.post("/remove", requirePermission("users.manage"), asyncHandler(membersController.remove));

// Reading and writing ONE member is owner-only, the same reasoning as
// permissions.routes.js: the editor writes users.permissions, which sits at
// the top of the precedence chain, so delegating it via a permission key
// would let a holder grant themselves the key that guards it.
// Registered after the static POSTs above so `/:id` never shadows them.
router.get("/:id", requireRole('owner'), asyncHandler(membersController.getOne));
router.put("/:id", requireRole('owner'), asyncHandler(membersController.save));

export default router;
