// ============================================================================
// Permanently deleting a connected account row.
//
// "Disconnect" only ever marked an account `revoked` — nothing deleted the row,
// so a revoked subaccount sat in the panel for good and clicking Disconnect
// again did nothing visible. This is the missing delete.
//
// IT IS NOT A PLAIN DELETE, because the foreign keys are not uniform. Measured
// on the live database, integration_accounts is referenced by eleven columns:
//
//   ON DELETE SET NULL   contacts, leads, communications, callrail_calls
//   ON DELETE CASCADE    invoices, payments, monthly_financials,
//                        ghl_appointments, bank_accounts,
//                        bank_balance_snapshots, ad_channel_pipelines
//
// So `delete from integration_accounts` where the row is a QuickBooks company
// silently destroys that company's entire P&L — one live account owns 957
// monthly_financials rows, 47 invoices and 18 bank accounts — and a legacy
// GoHighLevel row would take 137 synced appointments with it. The cascade is
// invisible from the call site, which is exactly why this is checked in the
// service rather than trusted to the database.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { integrationAccountRepository: repo } = await import('../src/repositories/integration-account.repository.js');
const { deleteAccountPermanently } = await import('../src/services/integration-account-delete.service.js');

const ORG = 'org-1';
const ACCOUNT = { id: 'acc-1', provider: 'gohighlevel', label: 'Old location', status: 'revoked' };
const NOTHING = { cascade: {}, detach: {} };

beforeEach(() => { vi.restoreAllMocks(); });

const stub = (account, impact) => {
  vi.spyOn(repo, 'getById').mockResolvedValue(account);
  vi.spyOn(repo, 'deleteById').mockResolvedValue(true);
  vi.spyOn(repo, 'ownedRowCounts').mockResolvedValue(impact);
};

describe('deleteAccountPermanently', () => {
  it('deletes a revoked account that owns nothing', async () => {
    stub(ACCOUNT, NOTHING);
    const out = await deleteAccountPermanently(ORG, 'acc-1', 'gohighlevel');
    expect(out).toMatchObject({ deleted: true });
    expect(repo.deleteById).toHaveBeenCalledWith(ORG, 'acc-1');
  });

  it('refuses to delete an account that is still connected', async () => {
    // Disconnect first, then delete. A live account must not be removable by a
    // stray click on a row the owner is still syncing.
    stub({ ...ACCOUNT, status: 'active' }, NOTHING);
    await expect(deleteAccountPermanently(ORG, 'acc-1', 'gohighlevel')).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('refuses, WITHOUT deleting, when the row owns records the cascade would destroy', async () => {
    stub(ACCOUNT, { cascade: { ghl_appointments: 137 }, detach: { leads: 351, communications: 54368 } });

    const err = await deleteAccountPermanently(ORG, 'acc-1', 'gohighlevel').catch((e) => e);

    expect(err.statusCode).toBe(409);
    // The refusal has to say WHAT is in the way, or the owner is simply stuck
    // with a button that does not work — which is the bug being fixed.
    expect(err.details.cascade).toEqual({ ghl_appointments: 137 });
    expect(err.details.detach).toEqual({ leads: 351, communications: 54368 });
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('deletes those records only when the caller confirms, and reports what went', async () => {
    stub(ACCOUNT, { cascade: { ghl_appointments: 137 }, detach: { leads: 351 } });

    const out = await deleteAccountPermanently(ORG, 'acc-1', 'gohighlevel', { confirm: true });

    expect(out).toMatchObject({ deleted: true, cascade: { ghl_appointments: 137 }, detach: { leads: 351 } });
    expect(repo.deleteById).toHaveBeenCalledWith(ORG, 'acc-1');
  });

  it('never touches another organisation\'s account', async () => {
    // getById is org-scoped, so a foreign id resolves to nothing at all — the
    // delete must stop there rather than fall through to a bare id delete.
    vi.spyOn(repo, 'getById').mockResolvedValue(null);
    vi.spyOn(repo, 'deleteById').mockResolvedValue(true);
    await expect(deleteAccountPermanently(ORG, 'someone-elses', 'gohighlevel')).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('refuses when the account belongs to a different provider than the route', async () => {
    // The routes are per-provider. A QuickBooks id posted to the GoHighLevel
    // delete route would otherwise drop a company's whole P&L through a panel
    // that never mentions QuickBooks.
    stub({ ...ACCOUNT, provider: 'quickbooks' }, NOTHING);
    await expect(deleteAccountPermanently(ORG, 'acc-1', 'gohighlevel')).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});
