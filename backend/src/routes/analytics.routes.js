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
import * as express_rate_limit_1 from "express-rate-limit";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as analytics_controller_1 from "../controllers/analytics.controller.js";
const router = (0, express_1.Router)();
// LLM-backed endpoints carry a per-IP+user rate limiter (costly calls); the
// per-org monthly token budget is enforced separately in the service layer.
const aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip || 'anon'}:${req.user?.id || 'anon'}`,
    message: { error: 'Too many AI requests. Try again in a minute.' },
});
const fin = (0, auth_1.requirePermission)('finance.view');
const val = (0, auth_1.requirePermission)('valuation.view');
// Phase 3 edit gates (rule 5: edits are owner-toggled, never finance.view).
// All persisted mutations below are audited by the audit middleware.
const finEdit = (0, auth_1.requirePermission)('finance.edit');
const valEdit = (0, auth_1.requirePermission)('valuation.edit');
// Data Quality (Phase 5) lives on the Data Hub (system.manage) page, not the
// finance views — gate it to match so a system admin without finance.view can
// still see connector + cleanliness health.
const sys = (0, auth_1.requirePermission)('system.manage');
// Attrition & Retention (Phase 6) lives next to Loyalty on the growth side — it
// is a patient-recall / marketing metric, not a money/valuation view, so it
// gates on growth.view (the same key the Loyalty page uses), letting a growth
// manager without finance.view see the recall opportunity.
const grw = (0, auth_1.requirePermission)('growth.view');
router.get('/dashboard', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboard));
router.get('/dashboard-summary', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dashboardSummary));
router.get('/revenue-series', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.revenueSeries));
router.get('/practice-summary', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.practiceSummary));
router.get('/business-hub', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.businessHub));
router.get('/leakage', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.leakage));
router.get('/data-quality', sys, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.dataQuality));
router.get('/retention', grw, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.retention));
router.get('/ai-insights', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.aiInsights));
router.post('/ai-insights/generate', aiLimiter, fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.generateInsights));
router.get('/decision-lens', aiLimiter, fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.decisionLens));
router.get('/finance-series', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.financeSeries));
router.get('/cashflow', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.cashflow));
router.get('/cashflow-outlook', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.cashflowOutlook));
router.get('/financial', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.financial));
router.get('/pl', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.pl));
router.get('/pl-benchmark', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.plBenchmark));
router.get('/pl-margin', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.plMargin));
router.get('/kpis', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.kpis));
router.get('/valuation', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuation));
router.get('/chair', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.chair));
router.get('/treatment-matrix', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentMatrix));
router.get('/treatment-revenue', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentRevenue));
router.get('/treatment-breakdown', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentBreakdown));
router.get('/cash-by-day', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.cashByDay));
router.get('/marketing-roi', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.marketingRoi));
router.get('/clinicians', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.clinicians));
router.post('/ai-ask', aiLimiter, fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.aiAsk));
// Treatment Economics Workbench — pure compute, audit-exempt (/compute/ path).
router.get('/compute/treatment-models', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentModels));
router.get('/treatment-fee-benchmarks', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentFeeBenchmarks));
router.post('/compute/treatment-economics', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.treatmentEconomics));
// Value & Growth — driver-based valuation + Sale Planner (pure compute,
// audit-exempt /compute/ path, valuation.view gate same as GET /valuation).
router.post('/compute/valuation', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuationCompute));
router.post('/compute/valuation/exit-plan', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.valuationExitPlan));
// M&A Acquisition Modeller (buy-side, DentaCFO Phase 3) — same pure-compute,
// audit-exempt /compute/ path + valuation.view gate as sell-side valuation.
router.post('/compute/acquisition', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.acquisition));

// Phase 3 / T12 — persisted config. GET = view gate; PUT = edit gate (audited).
router.get('/valuation-inputs', val, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.getValuationInputs));
router.put('/valuation-inputs', valEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.putValuationInputs));
router.get('/chair-config', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.getChairConfig));
router.put('/chair-config', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.putChairConfig));
router.get('/turnover-source', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.getTurnoverSource));
router.put('/turnover-source', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.putTurnoverSource));

// Phase 3 / T13 — editable P&L scenario sheets (scenario overlay; never feeds
// actuals). GET = finance.view; mutations = finance.edit (audited). The /csv
// export route is registered before /:id so it isn't shadowed.
router.get('/pl-sheets', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.listPlSheets));
router.post('/pl-sheets', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.createPlSheet));
router.get('/pl-sheets/:id/csv', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.exportPlSheetCsv));
router.get('/pl-sheets/:id', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.getPlSheet));
router.put('/pl-sheets/:id', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.updatePlSheet));
router.delete('/pl-sheets/:id', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.deletePlSheet));

// Board Report Generator (DentaCFO Phase 2). Generate/email are token-cost +
// outbound, so POST (never on page load); finance.view gate (board pack exposes
// group financials). Schedule CRUD: GET = view; mutations = finEdit (audited).
router.post('/board-report', aiLimiter, fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.boardReport));
router.post('/board-report/email', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.emailBoardReport));
router.get('/board-report/schedules', fin, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.listBoardSchedules));
router.post('/board-report/schedules', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.createBoardSchedule));
router.patch('/board-report/schedules/:id', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.updateBoardSchedule));
router.delete('/board-report/schedules/:id', finEdit, (0, async_handler_1.asyncHandler)(analytics_controller_1.analyticsController.deleteBoardSchedule));
export default router;
