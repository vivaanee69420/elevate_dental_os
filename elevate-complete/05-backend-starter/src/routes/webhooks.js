/**
 * Webhook router. Mounted at /v1/webhooks/*.
 * Each receiver handles its own raw-body + signature verification.
 */
const express = require('express');
const router = express.Router();

router.use('/dentally',    require('../webhooks/dentally'));
router.use('/xero',        require('../webhooks/xero'));
router.use('/quickbooks',  require('../webhooks/quickbooks'));
router.use('/ghl',         require('../webhooks/ghl'));
router.use('/stripe',      require('../webhooks/stripe'));

module.exports = router;
