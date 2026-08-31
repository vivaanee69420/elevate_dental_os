// ============================================================================
// Platform-admin routes — mounted at /api/platform. Public endpoint
// (rate-limited): POST /login. Everything else passes through
// platformAuthenticate first, and sensitive endpoints additionally require
// the superadmin role (the only platform tier after migration ...000012).
// ============================================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/async-handler.js';
import { platformAuthenticate, requirePlatformRole } from '../middleware/platform-auth.js';
import { platformAdminController } from '../controllers/platform-admin.controller.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a minute.' },
});

router.post('/login', loginLimiter, asyncHandler(platformAdminController.login));

router.use(platformAuthenticate);

router.get('/me',                          asyncHandler(platformAdminController.me));
router.post('/change-password',            asyncHandler(platformAdminController.changePassword));

// Create a tenant org + owner directly (auto-approved). Sensitive: superadmin.
router.post(
  '/orgs',
  requirePlatformRole('superadmin'),
  asyncHandler(platformAdminController.createOrg),
);

// Self-signup approval queue. Listing is read-only (any admin); approving or
// rejecting flips a tenant owner's login access, so it is superadmin-only.
router.get('/signups',                     asyncHandler(platformAdminController.listSignups));
router.post(
  '/signups/:id/approve',
  requirePlatformRole('superadmin'),
  asyncHandler(platformAdminController.approveSignup),
);
router.post(
  '/signups/:id/reject',
  requirePlatformRole('superadmin'),
  asyncHandler(platformAdminController.rejectSignup),
);

router.get('/orgs',                        asyncHandler(platformAdminController.listOrgs));
router.get('/orgs/:id',                    asyncHandler(platformAdminController.getOrg));
router.get('/orgs/:id/users',              asyncHandler(platformAdminController.getOrgUsers));
router.get('/orgs/:id/activity',           asyncHandler(platformAdminController.getOrgActivity));

router.get('/users',                       asyncHandler(platformAdminController.searchUsers));

// Grant/revoke agency access for one tenant user (users.is_agency_admin).
// Agency powers — sub-account creation, practice mapping, production logs —
// are no longer implied by owning an org, so this is the lever that hands
// them out. Superadmin-only, like the other privilege-changing actions.
router.patch(
  '/users/:id/agency-admin',
  requirePlatformRole('superadmin'),
  asyncHandler(platformAdminController.setAgencyAdmin),
);

router.get('/metrics/overview',            asyncHandler(platformAdminController.overview));
router.get('/metrics/integrations',        asyncHandler(platformAdminController.integrations));

router.get('/audit',                       asyncHandler(platformAdminController.auditCrossOrg));
router.get(
  '/audit/platform',
  requirePlatformRole('superadmin'),
  asyncHandler(platformAdminController.auditPlatform),
);

export default router;
