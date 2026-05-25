#!/usr/bin/env node
/**
 * Simple SQL migration runner. Tracks applied migrations in `schema_migrations`.
 * Runs every file in ./migrations/ alphabetically that hasn't been applied yet.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureTracking() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applied() {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map(r => r.filename));
}

async function run() {
  await ensureTracking();
  const done = await applied();
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  for (const f of files) {
    if (done.has(f)) {
      console.log(`✓ ${f} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`→ Applying ${f}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
    console.log(`✓ ${f}`);
  }

  console.log('Migrations complete.');
  await pool.end();
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
