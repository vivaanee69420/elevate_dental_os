// ============================================================================
// Emergent record identity: the natural key, and the JS/SQL agreement it rests on.
//
// Emergent sends no stable record id, so identity is synthesised. It used to be
// hashed over the RAW fields INCLUDING amount, which double-counted for real:
// 229 phantom rows and £1,014,647 of overstated accepted value on one tenant,
// feeding the Daily Cockpit, Business Hub and marketing attribution alike.
// 228 of the 229 duplicate pairs differed by nothing but trailing whitespace.
//
// Identity is now (organisation_id, source, business_id, accepted_date,
// patient_norm, treatment_norm), enforced by a unique index in migration
// 000149. These tests pin the two halves that have to agree: the JS hash and
// the SQL generated-column expressions.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  externalId, normaliseIdentityText, mapRecord,
} from '../src/lib/integrations/emergent-sync.js';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'supabase', 'migrations', '20260101000149_treatment_accepted_natural_key.sql',
);

// A real row from the live table, with the hash the DB computes for it. Pinned
// so a change to either side that breaks parity fails here rather than in
// production, where it would resurrect the duplicates.
const LIVE = {
  rec: {
    business_id: '25442cca-f21f-446e-af74-123c8626c36c',
    date: '2026-06-25',
    patient_name: 'Bryn Roberts',
    treatment_accepted: 'All on 4',
    amount: 19504,
  },
  sqlHash: 'c2fb81e342f79eb81c8438c07aee542a',
};

describe('normaliseIdentityText mirrors the SQL generated columns', () => {
  // SQL: lower(btrim(regexp_replace(coalesce(x,''), '\s+', ' ', 'g')))
  const cases = [
    ['Craig Attawater', 'craig attawater'],
    ['craig attawater ', 'craig attawater'],   // the actual live duplicate
    ['  Craig   Attawater  ', 'craig attawater'],
    ['CRAIG\tATTAWATER', 'craig attawater'],
    ['xla ', 'xla'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(normaliseIdentityText(input)).toBe(expected);
    });
  }
});

describe('externalId agrees with the database', () => {
  it('matches the hash Postgres computes for a live row', () => {
    expect(externalId(LIVE.rec)).toBe(LIVE.sqlHash);
  });

  it('the migration hashes the same four fields, in the same order', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // business_id | date | patient_norm | treatment_norm — and NOT amount.
    expect(sql).toMatch(/coalesce\(business_id, ''\)\s*\|\|\s*'\|'/);
    expect(sql).toMatch(/to_char\(accepted_date, 'YYYY-MM-DD'\)/);
    expect(sql).toMatch(/patient_norm \|\| '\|' \|\| treatment_norm/);
    expect(sql).toMatch(/'sha256'\), 'hex'\), 1, 32\)/);
  });

  it('the migration normalises exactly as normaliseIdentityText does', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("lower(btrim(regexp_replace(coalesce(patient_name, ''), '\\s+', ' ', 'g')))");
    expect(sql).toContain("lower(btrim(regexp_replace(coalesce(treatment_name, ''), '\\s+', ' ', 'g')))");
  });

  it('the migration enforces the key with NULLS NOT DISTINCT', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // Without this, a null business_id or treatment_name lets duplicates back in.
    expect(sql).toMatch(/NULLS NOT DISTINCT/);
    expect(sql).toMatch(/organisation_id, source, business_id, accepted_date, patient_norm, treatment_norm/);
  });

  it('organisation_id leads the key, so tenants can never collide', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const idx = sql.slice(sql.indexOf('uq_treatment_accepted_natural'));
    expect(idx).toMatch(/\(\s*organisation_id,/);
  });
});

describe('what does and does not change a record identity', () => {
  const base = LIVE.rec;

  // The whole point: cosmetic noise must not mint a second record.
  it('trailing whitespace does NOT — the live duplicate cause', () => {
    expect(externalId({ ...base, patient_name: 'Bryn Roberts ' })).toBe(externalId(base));
    expect(externalId({ ...base, treatment_accepted: 'All on 4  ' })).toBe(externalId(base));
  });

  it('case and internal spacing do NOT', () => {
    expect(externalId({ ...base, patient_name: '  BRYN   ROBERTS ' })).toBe(externalId(base));
  });

  // A plan logged at £0 and priced later must correct the record, not fork it.
  it('the amount does NOT — a re-price updates the record', () => {
    expect(externalId({ ...base, amount: 0 })).toBe(externalId(base));
    expect(externalId({ ...base, amount: 19504.00 })).toBe(externalId(base));
    expect(externalId({ ...base, amount: null })).toBe(externalId(base));
  });

  // These four ARE the identity, so each must move it.
  it('business, date, patient and treatment DO', () => {
    expect(externalId({ ...base, business_id: 'other' })).not.toBe(externalId(base));
    expect(externalId({ ...base, date: '2026-06-26' })).not.toBe(externalId(base));
    expect(externalId({ ...base, patient_name: 'Bryn Robertson' })).not.toBe(externalId(base));
    expect(externalId({ ...base, treatment_accepted: 'All on 6' })).not.toBe(externalId(base));
  });

  it('two different patients at the same business on the same day stay separate', () => {
    const a = externalId({ ...base, patient_name: 'Alice Adams' });
    const b = externalId({ ...base, patient_name: 'Bob Brown' });
    expect(a).not.toBe(b);
  });

  it('is deterministic — the same record always hashes the same', () => {
    expect(externalId(base)).toBe(externalId({ ...base }));
  });

  it('handles a record missing every identity field without throwing', () => {
    expect(typeof externalId({})).toBe('string');
    expect(externalId({})).toHaveLength(32);
  });
});

describe('mapRecord still produces a writable row', () => {
  it('carries the identity fields the natural key is built from', () => {
    const row = mapRecord(LIVE.rec, 'org-1');
    expect(row.organisation_id).toBe('org-1');
    expect(row.source).toBe('emergent');
    expect(row.business_id).toBe(LIVE.rec.business_id);
    expect(row.accepted_date).toBe(LIVE.rec.date);
    expect(row.external_id).toBe(LIVE.sqlHash);
  });

  // patient_norm / treatment_norm are GENERATED — writing them would error.
  it('does NOT write the generated normalised columns', () => {
    const row = mapRecord(LIVE.rec, 'org-1');
    expect(row).not.toHaveProperty('patient_norm');
    expect(row).not.toHaveProperty('treatment_norm');
  });

  it('money stays integer pence (rule 2)', () => {
    expect(mapRecord({ ...LIVE.rec, amount: 195.04 }, 'org-1').value_pence).toBe(19504);
  });
});

describe('the upsert targets the natural key, not the old hash', () => {
  const repo = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'repositories', 'treatment-accepted.repository.js'),
    'utf8',
  );

  it('conflict target is the natural key', () => {
    expect(repo).toContain(
      "'organisation_id,source,business_id,accepted_date,patient_norm,treatment_norm'",
    );
  });

  // Reverting to the external_id target reopens the whole bug.
  it('conflict target is NOT organisation_id,source,external_id', () => {
    expect(repo).not.toContain("onConflict: 'organisation_id,source,external_id'");
  });
});
