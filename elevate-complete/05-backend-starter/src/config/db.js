/**
 * Postgres connection pool. One pool per process.
 * All queries should go through `pool.query` or `withTx` for transactions.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', err => {
  console.error('Postgres pool error', err);
});

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTx };
