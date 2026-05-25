/**
 * Xero HTTP client.
 * See: ../../../04-integrations/XERO_SETUP.md
 */
const axios = require('axios');
const { decrypt } = require('../../config/secrets');
const { pool } = require('../../config/db');

async function makeClient(integrationId) {
  const { rows } = await pool.query(
    `SELECT t.access_token_ciphertext, t.refresh_token_ciphertext, t.expires_at, i.config
     FROM integration_tokens t
     JOIN integrations i ON i.id = t.integration_id
     WHERE t.integration_id = $1`,
    [integrationId]
  );
  if (!rows[0]) throw new Error(`No Xero token for integration ${integrationId}`);

  let accessToken = decrypt(rows[0].access_token_ciphertext);
  // Refresh if expiring within 5 minutes
  if (new Date(rows[0].expires_at) < new Date(Date.now() + 5 * 60_000)) {
    accessToken = await refreshTokens(integrationId, rows[0].refresh_token_ciphertext);
  }

  return axios.create({
    baseURL: 'https://api.xero.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': rows[0].config.tenant_id,
      Accept: 'application/json'
    },
    timeout: 30_000
  });
}

async function refreshTokens(integrationId, refreshTokenCiphertext) {
  const refreshToken = decrypt(refreshTokenCiphertext);
  const { data } = await axios.post('https://identity.xero.com/connect/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.XERO_CLIENT_ID,
      client_secret: process.env.XERO_CLIENT_SECRET
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const { encrypt } = require('../../config/secrets');
  await pool.query(
    `UPDATE integration_tokens
     SET access_token_ciphertext = $1,
         refresh_token_ciphertext = $2,
         expires_at = now() + ($3 || ' seconds')::interval,
         rotated_at = now()
     WHERE integration_id = $4`,
    [encrypt(data.access_token), encrypt(data.refresh_token), data.expires_in, integrationId]
  );
  return data.access_token;
}

module.exports = { makeClient };
