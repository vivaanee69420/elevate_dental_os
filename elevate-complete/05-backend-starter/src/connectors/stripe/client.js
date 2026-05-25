/**
 * Stripe client (Connect Standard).
 * See: ../../../04-integrations/STRIPE_SETUP.md
 */
const Stripe = require('stripe');
const { pool } = require('../../config/db');

async function makeClient(integrationId) {
  const { rows } = await pool.query(
    'SELECT config FROM integrations WHERE id = $1',
    [integrationId]
  );
  if (!rows[0]) throw new Error(`No Stripe integration ${integrationId}`);
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    stripeAccount: rows[0].config.stripe_user_id
  });
}

module.exports = { makeClient };
