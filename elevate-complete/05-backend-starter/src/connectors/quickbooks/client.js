/**
 * QuickBooks Online HTTP client.
 * See: ../../../04-integrations/QUICKBOOKS_SETUP.md
 */
const axios = require('axios');
const { decrypt, encrypt } = require('../../config/secrets');
const { pool } = require('../../config/db');

const BASE_URL = process.env.QBO_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

async function makeClient(integrationId) {
  const { rows } = await pool.query(
    `SELECT t.access_token_ciphertext, t.refresh_token_ciphertext, t.expires_at, i.config
     FROM integration_tokens t
     JOIN integrations i ON i.id = t.integration_id
     WHERE t.integration_id = $1`,
    [integrationId]
  );
  if (!rows[0]) throw new Error(`No QBO token for integration ${integrationId}`);

  let accessToken = decrypt(rows[0].access_token_ciphertext);
  if (new Date(rows[0].expires_at) < new Date(Date.now() + 5 * 60_000)) {
    accessToken = await refreshTokens(integrationId, rows[0].refresh_token_ciphertext);
  }

  return {
    realmId: rows[0].config.realm_id,
    axios: axios.create({
      baseURL: `${BASE_URL}/v3/company/${rows[0].config.realm_id}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      },
      timeout: 30_000
    })
  };
}

async function refreshTokens(integrationId, refreshTokenCiphertext) {
  const refreshToken = decrypt(refreshTokenCiphertext);
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const { data } = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
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
