/**
 * GoHighLevel webhook receiver.
 * See: ../../04-integrations/GOHIGHLEVEL_SETUP.md Day 3
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const queue = require('../jobs/queue');

router.post('/', express.json(), async (req, res) => {
  const locationId = req.body.locationId;
  const { rows: ints } = await pool.query(
    `SELECT id FROM integrations WHERE system = 'ghl' AND config->>'location_id' = $1 LIMIT 1`,
    [locationId]
  );
  const integrationId = ints[0]?.id;
  if (!integrationId) return res.status(404).json({ error: 'unknown_location' });

  const { rows } = await pool.query(
    `INSERT INTO raw_events (integration_id, event_type, external_id, payload, received_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [integrationId, req.body.type, req.body.id, req.body]
  );
  res.status(200).json({ received: true });
  await queue.add('ghl-normalize', { eventId: rows[0].id });
});

module.exports = router;
