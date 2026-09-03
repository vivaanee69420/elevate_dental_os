// ============================================================================
// Plan4Growth AI routes — Express Router. Mounted at /api/p4g-ai (auth applied
// upstream). AI routes carry a per-IP+user rate limiter (LLM calls are costly);
// the per-org monthly token budget is enforced separately in the service.
// ============================================================================
import * as express_1 from "express";
import * as express_rate_limit_1 from "express-rate-limit";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as p4g_ai_controller_1 from "../controllers/p4g-ai.controller.js";

const aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip || 'anon'}:${req.user?.id || 'anon'}`,
    message: { error: 'Too many AI requests. Try again in a minute.' },
});

const router = (0, express_1.Router)();
// Gated on `overview.view`. Both of these were completely ungated: any
// authenticated user could reach them, and the Mastermind AI answers over the
// organisation's business context. overview.view is held by owner, practice
// manager and reception by default, so this is strictly tighter than before
// and changes nothing for them.
router.use((0, auth_1.requirePermission)('overview.view'));
router.post('/chat', aiLimiter, (0, async_handler_1.asyncHandler)(p4g_ai_controller_1.p4gAiController.chat));
export default router;
