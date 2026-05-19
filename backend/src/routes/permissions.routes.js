'use strict';

// ============================================================================
// Permissions routes — mounted at /api/admin/permissions (behind the global
// /api authenticate + audit middleware). Every route additionally requires
// the dynamic 'permissions.manage' capability, so only roles the owner has
// granted matrix-editing can touch it. GET is gated too: the matrix reveals
// the org's whole access model.
// ============================================================================

const { Router } = require('express');
const { asyncHandler } = require('../middleware/async-handler');
const { requirePermission } = require('../middleware/auth');
const { permissionsController } = require('../controllers/permissions.controller');

const router = Router();

router.use(requirePermission('permissions.manage'));

router.get('/', asyncHandler(permissionsController.getMatrix));
router.put('/role', asyncHandler(permissionsController.setRoleDefault));
router.put('/user', asyncHandler(permissionsController.setUserOverride));

module.exports = router;
