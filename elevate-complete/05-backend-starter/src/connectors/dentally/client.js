/**
 * Dentally HTTP client.
 * See: ../../../04-integrations/DENTALLY_SETUP.md
 *
 * Notes:
 *   - User-Agent header is MANDATORY (Dentally rejects without it)
 *   - Rate limit: 10 req/s per integration · back off on 429
 *   - Never call list endpoints without a date filter
 */
const axios = require('axios');
const Bottleneck = require('bottleneck');
const { decrypt } = require('../../config/secrets');
const { pool } = require('../../config/db');

const limiters = new Map();

async function makeClient(integrationId) {
  // Get encrypted token for this integration
  const { rows } = await pool.query(
    'SELECT access_token_ciphertext FROM integration_tokens WHERE integration_id = $1',
    [integrationId]
  );
  if (!rows[0]) throw new Error(`No token for integration ${integrationId}`);
  const apiKey = decrypt(rows[0].access_token_ciphertext);

  // Per-integration rate limiter
  if (!limiters.has(integrationId)) {
    limiters.set(integrationId, new Bottleneck({ minTime: 100, maxConcurrent: 5 }));
  }
  const limiter = limiters.get(integrationId);

  const axiosClient = axios.create({
    baseURL: process.env.DENTALLY_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'ElevateOS/1.1 (engineering@elevateos.co)',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    timeout: 30_000
  });

  // Wrap each request with the limiter
  return {
    get: (path, opts) => limiter.schedule(() => axiosClient.get(path, opts)),
    post: (path, body, opts) => limiter.schedule(() => axiosClient.post(path, body, opts)),
    raw: axiosClient
  };
}

async function fetchAllPages(client, path, params = {}) {
  const results = [];
  let page = 1;
  while (true) {
    const { data } = await client.get(path, { params: { ...params, page, per_page: 100 } });
    const items = data[Object.keys(data)[0]];
    if (!Array.isArray(items)) break;
    results.push(...items);
    if (data.meta?.total_pages && page >= data.meta.total_pages) break;
    if (items.length < 100) break;
    page++;
  }
  return results;
}

module.exports = { makeClient, fetchAllPages };
