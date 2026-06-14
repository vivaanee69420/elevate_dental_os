// One-time migration runner — applies migration 000092 to the hosted Supabase
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260101000092_ghl_dashboard_account_filter.sql'),
  'utf8',
);

const SUPABASE_URL = 'https://mkfhpzjbijbachoonytt.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rZmhwempiaWpiYWNob29ueXR0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTA4MjE3NywiZXhwIjoyMDk0NjU4MTc3fQ.r0mDN42Q82jTqTISRsNpeMOZi6QcE8qFgcq1n7aNqZY';

// Use the PostgREST /rpc approach won't work for DDL — use the DB REST endpoint
// Supabase exposes a pg execute via the management API or via pg connection.
// We'll use the Supabase JS client with a raw query via the pg package.

// Actually, let us use node-postgres (pg) which is a backend dep
import pg from 'pg';
const { Client } = pg;

// Connection string from supabase URL pattern
const DB_URL = `postgresql://postgres.mkfhpzjbijbachoonytt:${process.env.SUPABASE_DB_PASSWORD}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;

async function run() {
  console.log('Checking DB password env var...');
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error('❌ SUPABASE_DB_PASSWORD not set. Cannot apply migration via direct connection.');
    console.log('\nAlternative: apply the SQL manually in the Supabase Dashboard SQL Editor.');
    console.log('File: supabase/migrations/20260101000092_ghl_dashboard_account_filter.sql');
    process.exit(1);
  }
  
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log('Connected to DB, applying migration...');
  await client.query(sql);
  console.log('✅ Migration 000092 applied successfully!');
  await client.end();
}

run().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
