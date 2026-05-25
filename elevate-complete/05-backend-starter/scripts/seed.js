#!/usr/bin/env node
/**
 * Seed a minimal development dataset: one org, one entity, five practices, one owner user.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const orgRes = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ('GM Dental Group', 'gm-dental-group')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const orgId = orgRes.rows[0].id;

  const entityRes = await pool.query(
    `INSERT INTO entities (organization_id, legal_name, accounting_basis, fiscal_year_end)
     VALUES ($1, 'GM Dental Group Ltd', 'accrual', '2026-03-31')
     ON CONFLICT (organization_id, legal_name) DO UPDATE SET accounting_basis = EXCLUDED.accounting_basis
     RETURNING id`,
    [orgId]
  );
  const entityId = entityRes.rows[0].id;

  const practices = [
    ['ASH', 'Ashford',                     6],
    ['ROC', 'Rochester',                   5],
    ['BAR', 'Barnet',                      5],
    ['WAR', 'Warwick Lodge · Herne Bay',   4],
    ['FTS', 'Fixed Teeth Solutions · Bexleyheath', 3]
  ];
  for (const [code, name, chairs] of practices) {
    await pool.query(
      `INSERT INTO practices (organization_id, entity_id, code, name, chairs)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, chairs = EXCLUDED.chairs`,
      [orgId, entityId, code, name, chairs]
    );
  }

  // Owner user
  const { rows: ownerRoleRows } = await pool.query(`SELECT id FROM roles WHERE code = 'owner'`);
  const ownerRoleId = ownerRoleRows[0].id;
  const passwordHash = await bcrypt.hash('change-me-on-first-login', 10);
  await pool.query(
    `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, role_id, active)
     VALUES ($1, 'owner@gmdental.local', $2, 'Gaurav', 'Mehta', $3, true)
     ON CONFLICT (email) DO NOTHING`,
    [orgId, passwordHash, ownerRoleId]
  );

  console.log('✅ Seeded GM Dental Group · 5 practices · owner user (owner@gmdental.local)');
  console.log('   Default password: change-me-on-first-login');
  await pool.end();
}

run().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
