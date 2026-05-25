/**
 * QuickBooks webhook receiver.
 * See: ../../04-integrations/QUICKBOOKS_SETUP.md Day 3
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db');
const queue = require('../jobs/queue');

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('intuit-signature');
  const expected = crypto
    .createHmac('sha256', process.env.QBO_WEBHOOK_VERIFIER)
    .update(req.body)
    .digest('base64');

  if (signature !== expected) return res.status(401).end();

  const payload = JSON.parse(req.body.toString());
  for (const notification of payload.eventNotifications || []) {
    for (const entity of notification.dataChangeEvent?.entities || []) {
      const integrationId = await resolveByRealm(notification.realmId);
      const { rows } = await pool.query(
        `INSERT INTO raw_events (integration_id, event_type, external_id, payload, signature)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [integrationId, `${entity.name}.${entity.operation}`.toLowerCase(), entity.id, entity, signature]
      );
      await queue.add('qbo-normalize', { eventId: rows[0].id });
    }
  }
  res.status(200).end();
});

async function resolveByRealm(realmId) {
  const { rows } = await pool.query(
    `SELECT id FROM integrations WHERE system = 'quickbooks' AND config->>'realm_id' = $1 LIMIT 1`,
    [realmId]
  );
  return rows[0]?.id;
}

module.exports = router;
