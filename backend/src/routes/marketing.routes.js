import express from 'express';
import { requirePermission } from '../middleware/auth.js';
import {
    getPerformance, getTrend, getLeads, getReconciliation,
    getFacebookCampaigns, getFacebookAdSets, getFacebookAds,
} from '../controllers/marketing.controller.js';

const router = express.Router();

// Dynamic RBAC gate, not requireRole — this is the path that matches the
// Team Permissions matrix. Reception never gets 'marketing.view' in
// DEFAULT_ROLE_PERMISSIONS (rule 5, CRM-only), so it stays denied by
// default, but an owner can also re-grant/revoke this per role/user.
router.get('/performance', requirePermission('marketing.view'), getPerformance);
router.get('/trend', requirePermission('marketing.view'), getTrend);
router.get('/leads', requirePermission('marketing.view'), getLeads);
router.get('/reconciliation', requirePermission('marketing.view'), getReconciliation);
router.get('/facebook/campaigns', requirePermission('marketing.view'), getFacebookCampaigns);
// Flat, query-filtered routes rather than nested drill-down paths: a
// standalone tab lists every ad set, or every ad, across the whole window
// with no parent id at all (?campaignId=/?adSetId= narrow it, same as
// practice_id does on all three).
router.get('/facebook/ad-sets', requirePermission('marketing.view'), getFacebookAdSets);   // ?campaignId=
router.get('/facebook/ads', requirePermission('marketing.view'), getFacebookAds);          // ?adSetId=

export default router;
