import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { integrationAccountRepository } = await import('../src/repositories/integration-account.repository.js');
const { ghlDashboardRepository } = await import('../src/repositories/ghl-dashboard.repository.js');
const { ghlDashboardService } = await import('../src/services/ghl-dashboard.service.js');

const WINDOW = { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' };

beforeEach(() => {
  vi.restoreAllMocks();
});

function stubAccounts(accounts) {
  vi.spyOn(integrationAccountRepository, 'list').mockResolvedValue(accounts);
}
function stubAggregate(rows) {
  vi.spyOn(ghlDashboardRepository, 'aggregate').mockResolvedValue(rows);
}

describe('getDashboard', () => {
  it('sums rows into totals and computes conversion %', async () => {
    stubAccounts([
      { id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: '2026-01-30T00:00:00Z', last_error: null },
      { id: 'a2', label: 'Maidstone', practice_id: 'p2', status: 'active', last_sync_at: null, last_error: null },
    ]);
    stubAggregate([
      { practice_id: 'p1', contacts_total: 10, contacts_new: 3, contacts_by_source: { ads: 6, referral: 4 },
        leads_total: 8, leads_new: 2, leads_open: 4, leads_won: 3, leads_lost: 1, pipeline_value_pence: 500000,
        leads_by_stage: { New: 4, Won: 3, Lost: 1 },
        conversations_total: 20, conversations_inbound: 12, conversations_outbound: 8, conversations_last7d: 5 },
      { practice_id: 'p2', contacts_total: 5, contacts_new: 1, contacts_by_source: { ads: 5 },
        leads_total: 2, leads_new: 0, leads_open: 1, leads_won: 1, leads_lost: 0, pipeline_value_pence: 100000,
        leads_by_stage: { New: 1, Won: 1 },
        conversations_total: 4, conversations_inbound: 1, conversations_outbound: 3, conversations_last7d: 0 },
    ]);

    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });

    expect(out.totals.contacts.total).toBe(15);
    expect(out.totals.contacts.new).toBe(4);
    expect(out.totals.contacts.bySource).toEqual([
      { source: 'ads', count: 11 }, { source: 'referral', count: 4 },
    ]);
    expect(out.totals.leads.total).toBe(10);
    expect(out.totals.leads.won).toBe(4);
    expect(out.totals.leads.lost).toBe(1);
    expect(out.totals.leads.pipelineValuePence).toBe(600000);
    expect(out.totals.leads.conversionPct).toBe(80);
    expect(out.totals.conversations.total).toBe(24);
    expect(out.totals.conversations.inbound).toBe(13);
    expect(out.totals.sync.accounts).toBe(2);
    expect(out.totals.sync.active).toBe(2);

    expect(out.perAccount).toHaveLength(2);
    const ashford = out.perAccount.find((a) => a.accountId === 'a1');
    expect(ashford).toMatchObject({
      label: 'Ashford', practiceId: 'p1', contacts: 10, leads: 8,
      pipelineValuePence: 500000, conversations: 20, status: 'active',
    });
  });

  it('returns zeroed totals and empty perAccount when no accounts', async () => {
    stubAccounts([]);
    stubAggregate([]);
    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });
    expect(out.totals.contacts.total).toBe(0);
    expect(out.totals.leads.conversionPct).toBe(0);
    expect(out.perAccount).toEqual([]);
  });

  it('buckets a null-practice aggregate row as Unmapped in perAccount', async () => {
    stubAccounts([{ id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: null, last_error: null }]);
    stubAggregate([
      { practice_id: 'p1', contacts_total: 4, contacts_new: 0, contacts_by_source: {}, leads_total: 0, leads_new: 0,
        leads_open: 0, leads_won: 0, leads_lost: 0, pipeline_value_pence: 0, leads_by_stage: {},
        conversations_total: 0, conversations_inbound: 0, conversations_outbound: 0, conversations_last7d: 0 },
      { practice_id: null, contacts_total: 7, contacts_new: 0, contacts_by_source: {}, leads_total: 0, leads_new: 0,
        leads_open: 0, leads_won: 0, leads_lost: 0, pipeline_value_pence: 0, leads_by_stage: {},
        conversations_total: 0, conversations_inbound: 0, conversations_outbound: 0, conversations_last7d: 0 },
    ]);
    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });
    expect(out.totals.contacts.total).toBe(11);
    const unmapped = out.perAccount.find((a) => a.accountId === null);
    expect(unmapped).toMatchObject({ label: 'Unmapped', contacts: 7 });
  });

  it('scopes the aggregate to a single account practice when accountId given', async () => {
    stubAccounts([
      { id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: null, last_error: null },
      { id: 'a2', label: 'Maidstone', practice_id: 'p2', status: 'active', last_sync_at: null, last_error: null },
    ]);
    const spy = vi.spyOn(ghlDashboardRepository, 'aggregate').mockResolvedValue([]);
    await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: 'a2', practiceId: null });
    expect(spy).toHaveBeenCalledWith('org-1', WINDOW.since, WINDOW.until, 'p2');
  });
});
