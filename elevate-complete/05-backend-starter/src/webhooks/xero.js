/**
 * Xero webhook receiver with HMAC-SHA256 signature verification.
 * See: ../../04-integrations/XERO_SETUP.md Day 5
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db');
const queue = require('../jobs/queue');

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('X-Xero-Signature');
  const expected = crypto
    .createHmac('sha256', process.env.XERO_WEBHOOK_KEY)
    .update(req.body)
    .digest('base64');

  if (signature !== expected) return res.status(401).end();

  const payload = JSON.parse(req.body.toString());
  for (const event of payload.events || []) {
    const integrationId = await resolveByTenant(event.tenantId);
    const { rows } = await pool.query(
      `INSERT INTO raw_events (integration_id, event_type, external_id, payload, signature)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [integrationId, `${event.eventCategory}.${event.eventType}`.toLowerCase(), event.resourceId, event, signature]
    );
    await queue.add('xero-normalize', { eventId: rows[0].id });
  }
  res.status(200).end();
});

async function resolveByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT id FROM integrations WHERE system = 'xero' AND config->>'tenant_id' = $1 LIMIT 1`,
    [tenantId]
  );
  return rows[0]?.id;
}

module.exports = router;
