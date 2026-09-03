// ============================================================================
// Dentally payment-status repair.
//
// mapPaymentStatus once sent Dentally's `unexplained` / `partially_explained`
// states to 'pending'. Those states mean money RECEIVED but not yet allocated
// to an invoice line, so the correct mapping is 'settled'. The MAPPER was
// fixed; the ROWS it had already written were not, because the nightly sync
// pulls a rolling recent window and never revisits old dates.
//
// The result is a silent, permanent understatement of Takings for any window
// covering the affected period. Live on BOTH orgs on this instance when this
// was written:
//     Plan4growth  5,418 rows / £830,468  (all dated <= 2024-10-01)
//     developer    5,422 rows / £843,310
// 2,713 of Plan4growth's were CARD or CASH — money handed over at the desk,
// which is never "pending". Anyone reconciling those years against Dentally
// would have found us low with no way to see why.
//
// The repair re-pulls the window and re-derives every row through the CURRENT
// mapper, so nothing is inferred from what we already hold.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { paymentRow } from '../src/lib/integrations/dentally-sync.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ORG = '11111111-1111-1111-1111-111111111111';

// paymentRow needs a site + contact map; practice_id is NOT NULL.
const siteMap = new Map([['site-1', 'practice-1']]);
const contactMap = new Map([['pat-1', 'contact-1']]);
const pay = (extra) => paymentRow(ORG, {
  id: 'p1', site_id: 'site-1', patient_id: 'pat-1', amount: '100.00',
  dated_on: '2024-03-01', ...extra,
}, siteMap, contactMap);

describe('the mapper treats received-but-unallocated money as received', () => {
  it('unexplained is settled, not pending', () => {
    expect(pay({ status: 'unexplained' }).status).toBe('settled');
  });

  it('partially_explained is settled, not pending', () => {
    expect(pay({ status: 'partially_explained' }).status).toBe('settled');
  });

  it('paid is settled', () => {
    expect(pay({ status: 'paid' }).status).toBe('settled');
    expect(pay({ paid: true }).status).toBe('settled');
  });

  it('failed and refunded keep their own meaning, not settled', () => {
    expect(pay({ status: 'failed' }).status).toBe('failed');
    expect(pay({ status: 'declined' }).status).toBe('failed');
    expect(pay({ status: 'refunded' }).status).toBe('refunded');
  });

  // Conservative on genuinely unknown states: never count unknown money as
  // received. That is the ONE case where 'pending' is still correct.
  it('an unrecognised state stays pending rather than being assumed received', () => {
    expect(pay({ status: 'some_future_state' }).status).toBe('pending');
  });
});

describe('the repair re-derives from the source, it does not guess', () => {
  const sync = readFileSync(join(SRC, 'lib', 'integrations', 'dentally-sync.js'), 'utf8');
  const fn = sync.slice(sync.indexOf('export async function repairPaymentStatuses'),
                        sync.indexOf('export async function countPaymentStatuses'));

  it('re-pulls the window from Dentally rather than rewriting local rows', () => {
    expect(fn).toMatch(/pullPayments\(/);
    // No local UPDATE of status anywhere in the repair — that would be a guess.
    expect(fn).not.toMatch(/\.update\(/);
    expect(fn).not.toMatch(/status:\s*'settled'/);
  });

  it('scopes the pull to the requested payment-date window', () => {
    expect(fn).toMatch(/dated_after/);
    expect(fn).toMatch(/dated_before/);
  });

  it('refuses to run without an explicit window', () => {
    expect(fn).toMatch(/if \(!since \|\| !until\) return \{ error: 'no_window' \}/);
  });

  it('reports what actually moved, rather than claiming success', () => {
    expect(fn).toMatch(/before/);
    expect(fn).toMatch(/after/);
    expect(fn).toMatch(/pendingCleared/);
  });

  it('never deletes — reconciliation owns that, deliberately separately', () => {
    expect(fn).not.toMatch(/\.delete\(/);
  });

  it('counts statuses with a paged read, so a wide window is not capped', () => {
    const counter = sync.slice(sync.indexOf('export async function countPaymentStatuses'));
    expect(counter.slice(0, 900)).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });
});

describe('the repair is owner-only and tenant-scoped', () => {
  const routes = readFileSync(join(SRC, 'routes', 'integrations.routes.js'), 'utf8');
  const controller = readFileSync(join(SRC, 'controllers', 'integration.controller.js'), 'utf8');

  it('is owner-only — it rewrites financial rows', () => {
    const line = routes.split('\n').find((l) => l.includes('dentally/repair-payments'));
    expect(line).toBeTruthy();
    expect(line).toMatch(/requireRole\)\('owner'\)/);
  });

  it('takes the org from the session, never from the body', () => {
    const fn = controller.slice(controller.indexOf('async dentallyRepairPayments'));
    expect(fn.slice(0, 400)).toMatch(/req\.user\.organisation_id/);
    expect(fn.slice(0, 400)).not.toMatch(/body\.(organisation_id|orgId)/);
  });

  it('validates the window shape', () => {
    const model = readFileSync(join(SRC, 'models', 'integration.model.js'), 'utf8');
    expect(model).toMatch(/dentallyPaymentRepairSchema/);
    expect(model).toMatch(/since must not be after until/);
  });
});

describe('the condition is surfaced to every tenant, not just discovered by hand', () => {
  const migration = readFileSync(
    join(SRC, '..', '..', 'supabase', 'migrations',
         '20260101000153_data_integrity_alerts_stale_payments.sql'),
    'utf8',
  );

  it('a stale-payment branch exists and is org-scoped', () => {
    expect(migration).toMatch(/'stale_payment_status'/);
    const branch = migration.slice(migration.indexOf("'stale_payment_status'"));
    expect(branch).toMatch(/organisation_id = \$1/);
  });

  // Cash and card are the tell: that money was physically received.
  it('escalates on cash/card volume rather than on raw row count', () => {
    const branch = migration.slice(migration.indexOf("'stale_payment_status'"));
    expect(branch).toMatch(/method IN \('cash','card'\)[\s\S]*?'high'/);
    expect(branch).toMatch(/method IN \('cash','card'\)[\s\S]*?'medium'/);
  });

  it('stays advisory — the detector reports, the repair fixes', () => {
    const branch = migration.slice(migration.indexOf("-- 6. Payments still carrying"));
    expect(branch).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
  });

  it('is service_role only', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION data_integrity_alerts\(uuid\) FROM PUBLIC, anon, authenticated/);
  });
});
