import express from 'express';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { requireOwnerOrAgencyActor } from '../middleware/agency.js';
import { openDayController } from '../controllers/open-day.controller.js';
import {
    getPerformance, getTrend, getLeads, getReconciliation,
    getFacebookCampaigns, getFacebookAdSets, getFacebookAds,
    getFacebookLeadPerformance,
    getGoogleCampaigns, getGoogleAdGroups, getGoogleAds, getGoogleKeywords,
    getGoogleSearchTerms,
    getGoogleLeadPerformance,
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
// Blended CPL / cost-per-booking / cost-per-accepted-patient for Meta, on the
// same money-paid acceptance rule as /google/lead-performance. ?practice_id=
router.get('/facebook/lead-performance', requirePermission('marketing.view'), getFacebookLeadPerformance);

// Open days (000168) — named events and the campaigns that promoted them.
//
// Reads sit behind the report's own permission so a practice manager can see
// the events behind the numbers. Writes are requireRole('owner') rather than
// requireAgencyActor, which is the gate every OTHER mapping mutation in this
// codebase uses: an open day is the tenant's own event, and making them ask
// their agency to record one would make the feature useless. Deliberate
// exception — see open-day.service.js's header before "fixing" it.
router.get('/facebook/open-days', requirePermission('marketing.view'), openDayController.list);
router.post('/facebook/open-days', requireRole('owner'), openDayController.create);
router.patch('/facebook/open-days/:id', requireRole('owner'), openDayController.update);
router.delete('/facebook/open-days/:id', requireRole('owner'), openDayController.remove);
router.put('/facebook/open-days/:id/campaigns', requireRole('owner'), openDayController.setCampaigns);
// Mapping a GHL pipeline to an open day is owner-OR-agency-actor, not
// owner-only like the routes above: an agency admin need not be an owner of
// the sub-account they administer, and owner-only would lock them out. See
// requireOwnerOrAgencyActor's header in middleware/agency.js.
router.put('/facebook/open-days/pipelines', requireOwnerOrAgencyActor, openDayController.setPipeline);

// Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords } — ads and
// keywords are SIBLINGS under an ad group (neither contains the other), which
// is why there are four routes here where Facebook has three. Same flat,
// query-filtered shape as the Facebook routes above.
router.get('/google/campaigns', requirePermission('marketing.view'), getGoogleCampaigns);
router.get('/google/ad-groups', requirePermission('marketing.view'), getGoogleAdGroups);   // ?campaignId=
router.get('/google/ads', requirePermission('marketing.view'), getGoogleAds);              // ?campaignId=&parentId=
router.get('/google/keywords', requirePermission('marketing.view'), getGoogleKeywords);    // ?campaignId=&parentId=
// Search terms — what people actually typed, as opposed to what we bid on.
// A 30-day window of its own, reported in the payload as windowDays.
router.get('/google/search-terms', requirePermission('marketing.view'), getGoogleSearchTerms); // ?campaignId=&parentId=

// Blended CPL/CPB/CPA cards, PRACTICE grain (not per-campaign — see
// google-report.service.js's leadPerformance for why). ?practice_id=
// narrows; omitted returns every practice's own row plus an all-practices
// total.
router.get('/google/lead-performance', requirePermission('marketing.view'), getGoogleLeadPerformance);

export default router;
