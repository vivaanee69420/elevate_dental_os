// ============================================================================
// Analytics routes — Express Router. Mounted at /api/analytics (authenticate +
// audit applied upstream in app.js).
//
// RBAC (project rule 5): analytics endpoints expose financials (revenue,
// profit, cash, valuation). serviceClient bypasses RLS, so the route gate is
// the tenant-trust boundary for *who* in an org may see money. Reception has
// neither finance.view nor valuation.view → 403 everywhere here. PM sees
// these only when the owner toggles finance.view (owner-toggled finance
// access, rule 5). Owner has all by default. This closes a pre-existing
// rule-5 violation (these routes shipped ungated).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as analytics_controller_1 from "../controllers/analytics.controller.js";
const router = (0, express_1.Router)();
const fin = (0, auth_1.requirePermission)('finance.view');
const val = (0, auth_1.requirePermission)('valuation.view');
router.get('/dashboard', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboard));
router.get('/dashboard-summary', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboardSummary));
router.get('/revenue-series', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.revenueSeries));
router.get('/practice-summary', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.practiceSummary));
router.get('/business-hub', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.businessHub));
router.get('/ai-insights', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.aiInsights));
router.post('/ai-insights/generate', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.generateInsights));
router.get('/finance-series', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.financeSeries));
router.get('/cashflow', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.cashflow));
router.get('/financial', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.financial));
router.get('/pl', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.pl));
router.get('/kpis', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.kpis));
router.get('/valuation', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuation));
export default router;
