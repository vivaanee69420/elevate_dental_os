// ============================================================================
// Auth routes — Express Router. Mounted PUBLIC at /auth, so auth is applied
// per-route here (the upstream /api authenticate middleware does NOT run):
//  - POST /signup : public.
//  - GET  /me     : authenticate.
//  - POST /invite : authenticate + requireRole('owner').
// Static paths registered before any param routes (none here).
// ============================================================================
import * as express_1 from "express";
import * as express_rate_limit_1 from "express-rate-limit";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as auth_controller_1 from "../controllers/auth.controller.js";
const router = (0, express_1.Router)();
// Brute-force / signup-spam gate: 5 attempts / minute / IP on the
// credential endpoints (mirrors the platform-admin login limiter). The
// global limiter is keyed by IP too; this is the tighter floor for the
// two endpoints that take a password.
const credentialLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'anon',
    message: { error: 'Too many attempts. Try again in a minute.' },
});
router.post('/signup', credentialLimiter, (0, async_handler_1.asyncHandler)(auth_controller_1.authController.signup));
router.post('/login', credentialLimiter, (0, async_handler_1.asyncHandler)(auth_controller_1.authController.login));
router.get('/me', auth_1.authenticate, (0, async_handler_1.asyncHandler)(auth_controller_1.authController.me));
// Switch which of the caller's accounts they act in. Authorisation is the
// membership itself, so this only confirms one exists — the Next layer stores
// the choice in an httpOnly cookie and the proxy replays it as x-active-org,
// which authenticate re-validates on every request.
router.post('/switch-org', auth_1.authenticate, (0, async_handler_1.asyncHandler)(auth_controller_1.authController.switchOrg));
// CQ1: gate by the dynamic 'users.invite' capability, not a hardcoded role.
router.post('/invite', auth_1.authenticate, (0, auth_1.requirePermission)('users.invite'), (0, async_handler_1.asyncHandler)(auth_controller_1.authController.invite));
export default router;
