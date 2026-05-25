/**
 * GoHighLevel HTTP client (Private Integration Token model).
 * See: ../../../04-integrations/GOHIGHLEVEL_SETUP.md
 */
const axios = require('axios');
const { decrypt } = require('../../config/secrets');
const { pool } = require('../../config/db');

async function makeClient(integrationId) {
  const { rows } = await pool.query(
    `SELECT t.access_token_ciphertext, i.config
     FROM integration_tokens t
     JOIN integrations i ON i.id = t.integration_id
     WHERE t.integration_id = $1`,
    [integrationId]
  );
  if (!rows[0]) throw new Error(`No GHL token for integration ${integrationId}`);

  const apiKey = decrypt(rows[0].access_token_ciphertext);
  const locationId = rows[0].config.location_id;

  return axios.create({
    baseURL: 'https://services.leadconnectorhq.com',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: '2021-07-28',
      Accept: 'application/json'
    },
    params: { locationId },
    timeout: 30_000
  });
}

module.exports = { makeClient };
