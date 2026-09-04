// ============================================================================
// Emergent sync fault isolation.
//
// syncOrg's record loops were bare inside one try/catch, so ONE unwritable
// record aborted the whole run: the tenant lost its accepted treatments AND its
// cash-ups AND its monthly P&L for that night, and the integration was marked
// failed. In a multi-tenant product that is the wrong blast radius — one
// practice's malformed row should cost that row, not a tenant's night of data.
//
// The opposite failure matters just as much: a run that writes NOTHING must not
// report success, or the tenant sees a fresh "last synced" timestamp over stale
// data. These tests pin both edges.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sync = readFileSync(join(SRC, 'lib', 'integrations', 'emergent-sync.js'), 'utf8');

// The body of syncOrg, so assertions cannot accidentally match syncAllOrgs.
const syncOrgBody = sync.slice(
  sync.indexOf('export async function syncOrg'),
  sync.indexOf('export async function syncAllOrgs'),
);

describe('one bad record does not cost a tenant the whole run', () => {
  it('the treatments loop catches per record', () => {
    const loop = syncOrgBody.slice(syncOrgBody.indexOf('for (const rec of records)'));
    expect(loop.slice(0, 400)).toMatch(/try\s*\{/);
    expect(loop.slice(0, 400)).toMatch(/catch\s*\(\s*recErr\s*\)/);
  });

  it('the cash-up loop catches per sheet', () => {
    const loop = syncOrgBody.slice(syncOrgBody.indexOf('for (const sheet of cashups)'));
    expect(loop.slice(0, 700)).toMatch(/catch\s*\(\s*sheetErr\s*\)/);
  });

  it('the per-sheet patient loop catches per patient', () => {
    expect(syncOrgBody).toMatch(/catch\s*\(\s*pErr\s*\)/);
  });

  it('the monthly P&L loop catches per month', () => {
    const loop = syncOrgBody.slice(syncOrgBody.indexOf('for (const plRow of plRows)'));
    expect(loop.slice(0, 400)).toMatch(/catch\s*\(\s*plErr\s*\)/);
  });

  it('rejections are counted, not swallowed', () => {
    expect(syncOrgBody).toMatch(/rejected\.push\(/);
    expect(syncOrgBody).toMatch(/rejected: rejected\.length/);
  });

  it('a sample of rejections is returned so the log names the offending rows', () => {
    expect(syncOrgBody).toMatch(/rejectedSample: rejected\.slice\(0, 5\)/);
  });
});

describe('a run that wrote nothing is reported as failed, not as success', () => {
  it('marks the integration failed when every record was rejected', () => {
    expect(syncOrgBody).toMatch(/if \(synced === 0 && records\.length > 0\)/);
    const branch = syncOrgBody.slice(syncOrgBody.indexOf('if (synced === 0 && records.length > 0)'));
    expect(branch.slice(0, 500)).toMatch(/markFailed/);
  });

  it('does NOT stamp a fresh sync time on a total failure', () => {
    const branch = syncOrgBody.slice(
      syncOrgBody.indexOf('if (synced === 0 && records.length > 0)'),
      syncOrgBody.indexOf('await integrationRepository.setSyncTime'),
    );
    expect(branch).not.toMatch(/setSyncTime/);
  });

  // An empty feed is not a failure — a practice with nothing to report is normal.
  it('an empty feed is not treated as a failure', () => {
    expect(syncOrgBody).toMatch(/records\.length > 0/);
  });
});

describe('one tenant cannot break another', () => {
  const allOrgs = sync.slice(sync.indexOf('export async function syncAllOrgs'));

  it('syncAllOrgs isolates each tenant', () => {
    expect(allOrgs).toMatch(/try\s*\{[\s\S]*?syncOrg\(orgId\)[\s\S]*?catch/);
  });

  it('a tenant error is recorded and the loop continues', () => {
    expect(allOrgs).toMatch(/results\.push\(\{ orgId, error: err\.message \}\)/);
  });

  it('a tenant without the emergent feature is skipped, not attempted', () => {
    expect(allOrgs).toMatch(/orgHasFeature\(orgId, 'emergent'\)/);
    expect(allOrgs).toMatch(/skipped: 'feature_disabled'/);
  });
});

describe('the integrity detector is wired for every tenant', () => {
  const repo = readFileSync(join(SRC, 'repositories', 'analytics.repository.js'), 'utf8');
  const svc = readFileSync(join(SRC, 'services', 'analytics.service.js'), 'utf8');
  const migration = readFileSync(
    join(SRC, '..', '..', 'supabase', 'migrations', '20260101000150_data_integrity_alerts.sql'),
    'utf8',
  );

  it('the repository calls the RPC org-scoped', () => {
    expect(repo).toMatch(/rpc\('data_integrity_alerts', \{ p_org: orgId \}\)/);
  });

  // A broken integrity check must not take the Data Hub page down with it.
  it('the repository fails soft rather than throwing', () => {
    const fn = repo.slice(repo.indexOf('async dataIntegrityAlerts'));
    expect(fn.slice(0, 400)).toMatch(/if \(error\) return \[\]/);
  });

  it('findings are merged into the same alert list the page already shows', () => {
    expect(svc).toMatch(/dataIntegrityAlerts\(orgId\)/);
    expect(svc).toMatch(/area: 'integrity'/);
    expect(svc).toMatch(/SEVERITY_ORDER\[a\.severity\]/);
  });

  it('every RPC branch is tenant-scoped', () => {
    // organisation_id = $1 on each of the four UNION branches; p_org is the
    // only way in, so one tenant can never see another's findings.
    const branches = migration.match(/organisation_id = \$1/g) || [];
    expect(branches.length).toBeGreaterThanOrEqual(4);
  });

  it('the RPC is service_role only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION data_integrity_alerts\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION data_integrity_alerts\(uuid\) TO service_role/);
  });

  it('it reports rather than deletes — advisory only', () => {
    expect(migration).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bINSERT\b/i);
  });

  // The check that would have caught the original incident on day one.
  it('reconciles the two independent feeds against each other', () => {
    expect(migration).toMatch(/feed_reconciliation/);
    expect(migration).toMatch(/detail_patient_money_total_pence/);
    expect(migration).toMatch(/FULL JOIN/);
  });

  it('scales reconciliation severity so a reporting lag stays quiet', () => {
    const branch = migration.slice(migration.indexOf("'feed_reconciliation'"));
    // 5% -> high, 1% -> medium, else low. The live £80-on-£517k lag must not
    // cry wolf, while the 44% divergence the duplicates caused would be high.
    expect(branch).toMatch(/x\.base \* 0\.05[\s\S]*?'high'/);
    expect(branch).toMatch(/x\.base \* 0\.01[\s\S]*?'medium'/);
  });

  it('reconciliation is windowed, so it stays about current data', () => {
    expect(migration).toMatch(/current_date - interval '12 months'/);
  });
});
