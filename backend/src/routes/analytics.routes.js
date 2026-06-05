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
router.get('/chair', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.chair));
// Treatment Economics Workbench — pure compute, audit-exempt (/compute/ path).
router.get('/compute/treatment-models', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentModels));
router.post('/compute/treatment-economics', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentEconomics));
// Value & Growth — driver-based valuation + Sale Planner (pure compute,
// audit-exempt /compute/ path, valuation.view gate same as GET /valuation).
router.post('/compute/valuation', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuationCompute));
router.post('/compute/valuation/exit-plan', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuationExitPlan));
export default router;
