/**
 * Stripe webhook receiver with signature verification.
 * See: ../../04-integrations/STRIPE_SETUP.md Day 2
 */
const express = require('express');
const Stripe = require('stripe');
const router = express.Router();
const { pool } = require('../config/db');
const queue = require('../jobs/queue');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Signature: ${err.message}` });
  }

  const { rows: ints } = await pool.query(
    `SELECT id FROM integrations WHERE system = 'stripe' AND config->>'stripe_user_id' = $1 LIMIT 1`,
    [event.account]
  );

  const { rows } = await pool.query(
    `INSERT INTO raw_events (integration_id, event_type, external_id, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ints[0]?.id, event.type, event.id, event]
  );
  res.status(200).json({ received: true });
  await queue.add('stripe-normalize', { eventId: rows[0].id });
});

module.exports = router;
