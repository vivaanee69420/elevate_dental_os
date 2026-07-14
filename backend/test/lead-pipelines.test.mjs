// leadService.pipelines — the Pipeline screen's stage-column source.
//
// Regression: pipelines used to come from the legacy org-level `integrations`
// config, which only ever holds ONE GHL Location's pipelines. With several
// subaccounts connected, picking any other subaccount showed that one location's
// pipeline names and zero leads (their leads carry a different location's
// pipeline ids). Pipelines must come from the per-account config.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { integrationAccountRepository } = await import('../src/repositories/integration-account.repository.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');
const { leadRepository } = await import('../src/repositories/lead.repository.js');
const { leadService } = await import('../src/services/lead.service.js');

const BARNET = {
  id: 'acct-barnet',
  label: 'GM Dental And Implant Centre Barnet',
  config: {
    pipelines: [
      { id: 'pipe-barnet-1', name: '2. Facebook Ads Leads', stages: [{ id: 's1', name: 'New Lead' }] },
      { id: 'pipe-barnet-2', name: '6. Chatbot Leads', stages: [{ id: 's2', name: 'Contacted' }] },
    ],
  },
};
const LEGACY = {
  id: 'acct-legacy',
  label: 'GoHighLevel',
  config: {
    pipelines: [{ id: 'pipe-diploma', name: 'Diploma Leads', stages: [{ id: 's3', name: 'New Lead' }] }],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  stubCounts([]);
});

function stubAccounts(accounts) {
  vi.spyOn(integrationAccountRepository, 'list').mockResolvedValue(accounts);
}
function stubLegacyIntegration(config) {
  vi.spyOn(integrationRepository, 'getByProvider').mockResolvedValue(config ? { config } : null);
}
function stubCounts(rows) {
  vi.spyOn(leadRepository, 'pipelineCounts').mockResolvedValue(rows);
}

describe('leadService.pipelines', () => {
  it('returns ONLY the selected subaccount pipelines when an account is given', async () => {
    stubAccounts([LEGACY, BARNET]);
    stubLegacyIntegration({ pipelines: LEGACY.config.pipelines });

    const { pipelines } = await leadService.pipelines('org-1', { integration_account_id: 'acct-barnet' });

    expect(pipelines.map((p) => p.name)).toEqual(['2. Facebook Ads Leads', '6. Chatbot Leads']);
    expect(pipelines.find((p) => p.name === 'Diploma Leads')).toBeUndefined();
  });

  it('unions every subaccount pipeline when no account is selected (All subaccounts)', async () => {
    stubAccounts([LEGACY, BARNET]);
    stubLegacyIntegration({ pipelines: LEGACY.config.pipelines });

    const { pipelines } = await leadService.pipelines('org-1', {});

    expect(pipelines.map((p) => p.id).sort()).toEqual(['pipe-barnet-1', 'pipe-barnet-2', 'pipe-diploma']);
  });

  it('de-duplicates a pipeline id shared by two accounts', async () => {
    stubAccounts([BARNET, { ...LEGACY, config: { pipelines: [...LEGACY.config.pipelines, BARNET.config.pipelines[0]] } }]);
    stubLegacyIntegration(null);

    const { pipelines } = await leadService.pipelines('org-1', {});

    expect(pipelines.filter((p) => p.id === 'pipe-barnet-1')).toHaveLength(1);
  });

  it('falls back to the legacy org-level integration config when no accounts exist', async () => {
    stubAccounts([]);
    stubLegacyIntegration({ pipelines: LEGACY.config.pipelines });

    const { pipelines } = await leadService.pipelines('org-1', {});

    expect(pipelines.map((p) => p.name)).toEqual(['Diploma Leads']);
  });

  it('returns an empty list, not a throw, when nothing is connected', async () => {
    stubAccounts([]);
    stubLegacyIntegration(null);

    await expect(leadService.pipelines('org-1', {})).resolves.toEqual({ pipelines: [] });
  });

  it('orders busiest-first and attaches lead counts, so the default pick is not an empty pipeline', async () => {
    stubAccounts([BARNET]);
    stubLegacyIntegration(null);
    // GHL returns "2. Facebook Ads Leads" first, but it is the near-empty one.
    stubCounts([
      { ghl_pipeline_id: 'pipe-barnet-1', lead_count: 1, value_pence: 5000 },
      { ghl_pipeline_id: 'pipe-barnet-2', lead_count: 873, value_pence: 120000 },
    ]);

    const { pipelines } = await leadService.pipelines('org-1', { integration_account_id: 'acct-barnet' });

    expect(pipelines.map((p) => p.name)).toEqual(['6. Chatbot Leads', '2. Facebook Ads Leads']);
    expect(pipelines[0].lead_count).toBe(873);
    expect(pipelines[0].value_pence).toBe(120000);
  });

  it('keeps pipelines with no leads, at the end of the list', async () => {
    stubAccounts([BARNET]);
    stubLegacyIntegration(null);
    stubCounts([{ ghl_pipeline_id: 'pipe-barnet-2', lead_count: 4, value_pence: 0 }]);

    const { pipelines } = await leadService.pipelines('org-1', { integration_account_id: 'acct-barnet' });

    expect(pipelines.map((p) => p.name)).toEqual(['6. Chatbot Leads', '2. Facebook Ads Leads']);
    expect(pipelines[1].lead_count).toBe(0);
  });

  it('returns an empty list for an account id that is not in this org', async () => {
    stubAccounts([BARNET]);
    stubLegacyIntegration({ pipelines: LEGACY.config.pipelines });

    const { pipelines } = await leadService.pipelines('org-1', { integration_account_id: 'acct-other-org' });

    expect(pipelines).toEqual([]);
  });
});
