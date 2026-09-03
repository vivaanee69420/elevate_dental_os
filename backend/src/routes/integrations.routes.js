// ============================================================================
// Integrations routes — Express Router. Mounted at /api/integrations.
// Owner-only RBAC. Static paths before param routes.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as integration_controller_1 from "../controllers/integration.controller.js";
import * as daily_report_controller_1 from "../controllers/daily-report.controller.js";
import * as features_1 from "../middleware/features.js";
import { requireAgencyActor } from "../middleware/agency.js";
import { sheetsController } from "../controllers/sheets.controller.js";
import { sheetExportController } from "../controllers/sheet-export.controller.js";
const router = (0, express_1.Router)();
const emergentFeature = (0, features_1.requireFeature)('emergent');
const callReportingFeature = (0, features_1.requireFeature)('call_reporting');
const sheetExportFeature = (0, features_1.requireFeature)('sheet_export');
router.get('/', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.list));
router.post('/connect', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.connect));
router.post('/sync-all', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.syncAll));
router.get('/gohighlevel/accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountsList));
router.get('/gohighlevel/dashboard', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlDashboard));
router.get('/gohighlevel/daily-report', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.getSettings));
router.put('/gohighlevel/daily-report', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.saveSettings));
router.post('/gohighlevel/daily-report/preview', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.preview));
router.post('/gohighlevel/daily-report/send', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.send));
router.post('/gohighlevel/accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountCreate));
router.patch('/gohighlevel/accounts/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountUpdate));
router.delete('/gohighlevel/accounts/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountRemove));
router.post('/gohighlevel/accounts/:id/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountSync));
router.get('/gohighlevel/accounts/:id/pipelines', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountPipelines));
router.post('/gohighlevel/accounts/:id/stage-mappings', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlAccountStageMappings));
router.get('/emergent', emergentFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentGet));
router.post('/emergent', emergentFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentConnect));
router.post('/emergent/sync', emergentFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentSync));
router.delete('/emergent', emergentFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentDisconnect));
router.get('/emergent/practices', emergentFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentPractices));
// Emergent business→practice mapping is an agency-actor power (A2).
router.post('/emergent/practices', emergentFeature, (0, auth_1.requireRole)('owner'), requireAgencyActor, (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentSetPractice));
router.get('/google-sheets/status', callReportingFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetsController.status));
router.get('/google-sheets/picker-config', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.pickerConfig));
router.post('/google-sheets/sources', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.addSource));
router.get('/google-sheets/sources/:id/preview', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.preview));
router.put('/google-sheets/sources/:id/mapping', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.saveMapping));
router.post('/google-sheets/sources/:id/sync', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.sync));
router.delete('/google-sheets/sources/:id', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.removeSource));
router.delete('/google-sheets', callReportingFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetsController.disconnect));
router.get('/google-sheets-writer/status', sheetExportFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetExportController.status));
router.get('/google-sheets-writer/activity', sheetExportFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(sheetExportController.activity));
router.post('/google-sheets-writer/destination', sheetExportFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.setDestination));
router.post('/google-sheets-writer/drain', sheetExportFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.drain));
router.delete('/google-sheets-writer', sheetExportFeature, (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(sheetExportController.disconnect));
router.get('/quickbooks/accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.qbAccountsList));
router.post('/quickbooks/accounts/connect', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.qbAccountConnect));
router.post('/quickbooks/accounts/:id/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.qbAccountSync));
router.delete('/quickbooks/accounts/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.qbAccountRemove));
// CallRail — provider-level status/sync/disconnect (Task 3). Task 4 adds the
// per-company /accounts routes beside these. STATIC paths: must stay above
// the generic /:provider/* routes below, or '/callrail'/'/callrail/sync'
// are swallowed by '/:id' and '/:provider/sync' respectively.
router.get('/callrail', (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callrailGet));
router.post('/callrail/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callrailSync));
router.delete('/callrail', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callrailDisconnect));
router.get('/:provider/callback', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callback));
router.post('/:provider/callback', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.callback));
router.post('/:provider/refresh', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.refresh));
router.post('/:provider/sync', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.sync));
router.get('/:provider/site-ids', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.siteIds));
router.get('/:provider/pipelines', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.pipelines));
router.post('/:provider/stage-mappings', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setStageMappings));
router.get('/:provider/sync-progress', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.syncProgress));
router.get('/:provider/webhook-info', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.webhookInfo));
router.post('/:provider/webhook-secret', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setWebhookSecret));
router.post('/:provider/revoke', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.revoke));
router.get('/:provider/ad-accounts', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.adAccounts));
router.post('/:provider/ad-accounts/selection', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.setAdAccountSelection));
router.delete('/:id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.remove));
export default router;
