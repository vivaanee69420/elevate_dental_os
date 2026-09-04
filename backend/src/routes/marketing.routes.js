import express from 'express';
import { requirePermission } from '../middleware/auth.js';
import {
    getPerformance, getTrend, getLeads, getReconciliation,
    getFacebookCampaigns, getFacebookAdSets, getFacebookAds,
    getGoogleCampaigns, getGoogleAdGroups, getGoogleAds, getGoogleKeywords,
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

// Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords } — ads and
// keywords are SIBLINGS under an ad group (neither contains the other), which
// is why there are four routes here where Facebook has three. Same flat,
// query-filtered shape as the Facebook routes above.
router.get('/google/campaigns', requirePermission('marketing.view'), getGoogleCampaigns);
router.get('/google/ad-groups', requirePermission('marketing.view'), getGoogleAdGroups);   // ?campaignId=
router.get('/google/ads', requirePermission('marketing.view'), getGoogleAds);              // ?campaignId=&parentId=
router.get('/google/keywords', requirePermission('marketing.view'), getGoogleKeywords);    // ?campaignId=&parentId=

export default router;
