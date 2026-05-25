/**
 * Router composition. Each domain module exports an express.Router().
 *
 * NOTE: Webhook routes are mounted last because they bypass JSON body parsing
 * (they need the raw body for signature verification).
 */
const express = require('express');
const router = express.Router();

router.use('/auth',            require('./auth'));
router.use('/permissions',     require('./permissions'));
router.use('/practices',       require('./practices'));
router.use('/finance',         require('./finance'));
router.use('/patients',        require('./patients'));
router.use('/appointments',    require('./appointments'));
router.use('/crm',             require('./crm'));
router.use('/launch',          require('./launch'));
router.use('/reconciliation',  require('./reconciliation'));
router.use('/uploads',         require('./uploads'));
router.use('/board-packs',     require('./board-packs'));
router.use('/integrations',    require('./integrations'));
router.use('/audit-logs',      require('./audit'));
router.use('/kpis',            require('./kpis'));
router.use('/webhooks',        require('./webhooks'));

module.exports = router;
