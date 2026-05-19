// ============================================================================
// Team routes — mounted /api/admin/team behind global authenticate + audit.
// list/invite require 'users.invite'; remove requires 'users.manage'
// (dynamic RBAC — only roles the owner has granted these can manage the team).
// ============================================================================

import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/auth.js";
import { membersController } from "../controllers/members.controller.js";

const router = Router();

router.get("/", requirePermission("users.invite"), asyncHandler(membersController.list));
router.post("/invite", requirePermission("users.invite"), asyncHandler(membersController.invite));
router.post("/remove", requirePermission("users.manage"), asyncHandler(membersController.remove));

export default router;
