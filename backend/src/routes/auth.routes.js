"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================================
// Auth routes — Express Router. Mounted PUBLIC at /auth, so auth is applied
// per-route here (the upstream /api authenticate middleware does NOT run):
//  - POST /signup : public.
//  - GET  /me     : authenticate.
//  - POST /invite : authenticate + requireRole('owner').
// Static paths registered before any param routes (none here).
// ============================================================================
const express_1 = require("express");
const async_handler_1 = require("../middleware/async-handler");
const auth_1 = require("../middleware/auth");
const auth_controller_1 = require("../controllers/auth.controller");
const router = (0, express_1.Router)();
router.post('/signup', (0, async_handler_1.asyncHandler)(auth_controller_1.authController.signup));
router.get('/me', auth_1.authenticate, (0, async_handler_1.asyncHandler)(auth_controller_1.authController.me));
router.post('/invite', auth_1.authenticate, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(auth_controller_1.authController.invite));
exports.default = router;
