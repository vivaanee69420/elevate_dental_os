/**
 * Dentally webhook receiver.
 * See: ../../04-integrations/DENTALLY_SETUP.md Day 3
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const queue = require('../jobs/queue');

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    const { rows } = await pool.query(
      `INSERT INTO raw_events (integration_id, event_type, external_id, payload, signature, received_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [
        await resolveDentallyIntegration(event),
        event.event,
        event.id,
        req.body.toString(),
        req.get('X-Dentally-Signature')
      ]
    );
    res.status(202).json({ received: true });
    await queue.add('dentally-normalize', { eventId: rows[0].id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function resolveDentallyIntegration(event) {
  // Resolve via account_id or site_id in the payload
  // Placeholder — implement based on Dentally payload shape
  const { rows } = await pool.query(
    `SELECT id FROM integrations WHERE system = 'dentally' AND status = 'connected' LIMIT 1`
  );
  return rows[0]?.id;
}

module.exports = router;
