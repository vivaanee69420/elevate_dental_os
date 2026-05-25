/**
 * launch routes
 * TODO: implement against the API contract in 03-backend-spec/API_CONTRACT.md
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');

router.use(requireAuth);

router.get('/', (req, res) => {
  res.status(501).json({ error: { code: 'not_implemented', message: 'launch endpoints stub — implement against API_CONTRACT.md' } });
});

module.exports = router;
