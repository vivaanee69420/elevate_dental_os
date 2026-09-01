import express from 'express';
import { requirePermission } from '../middleware/auth.js';
import { getPerformance, getTrend, getLeads } from '../controllers/marketing.controller.js';

const router = express.Router();

// Dynamic RBAC gate, not requireRole — this is the path that matches the
// Team Permissions matrix. Reception never gets 'marketing.view' in
// DEFAULT_ROLE_PERMISSIONS (rule 5, CRM-only), so it stays denied by
// default, but an owner can also re-grant/revoke this per role/user.
router.get('/performance', requirePermission('marketing.view'), getPerformance);
router.get('/trend', requirePermission('marketing.view'), getTrend);
router.get('/leads', requirePermission('marketing.view'), getLeads);

export default router;
