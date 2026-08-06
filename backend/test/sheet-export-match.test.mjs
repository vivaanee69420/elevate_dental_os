// Matcher service — Dentally contact -> GHL contact w/ pipeline lead.
// Repositories mocked at module level (vi.mock); normalise.js used for real
// (pure, deterministic) so email/phone equality checks exercise real logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/sheet-export.repository.js', () => ({
  sheetExportRepository: {
    ghlCandidatesByEmail: vi.fn(),
    ghlCandidatesByPhone: vi.fn(),
    pipelineLeads: vi.fn(),
  },
}));

vi.mock('../src/repositories/integration-account.repository.js', () => ({
  integrationAccountRepository: {
    list: vi.fn(),
  },
}));

vi.mock('../src/repositories/integration.repository.js', () => ({
  integrationRepository: {
    getByProvider: vi.fn(),
  },
}));

import { sheetExportRepository } from '../src/repositories/sheet-export.repository.js';
import { integrationAccountRepository } from '../src/repositories/integration-account.repository.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { findMatch, pipelineNameMap } from '../src/services/sheet-export-match.service.js';

const ORG = '00000000-0000-0000-0000-000000000001';

function contact(overrides = {}) {
  return {
    id: 'ghl-1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@x.com',
    phone: '+447123456789',
    ghl_contact_id: 'ghl-ext-1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function lead(overrides = {}) {
  return {
    id: 'lead-1',
    contact_id: 'ghl-1',
    ghl_pipeline_id: 'pipe-1',
    created_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  integrationAccountRepository.list.mockResolvedValue([]);
  integrationRepository.getByProvider.mockResolvedValue(null);
});

describe('findMatch', () => {
  it('1. email hit: returns matched contact + lead + resolved pipeline name', async () => {
    const c = contact({ email: 'jane@x.com' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([lead({ contact_id: c.id })]);
    integrationAccountRepository.list.mockResolvedValue([
      { config: { pipelines: [{ id: 'pipe-1', name: 'New Patient Enquiries' }] } },
    ]);

    const dentally = { id: 'd-1', email: 'Jane@X.com', phone: null };
    const result = await findMatch(ORG, dentally);

    expect(result).not.toBeNull();
    expect(result.matchedContact).toEqual(c);
    expect(result.lead.id).toBe('lead-1');
    expect(result.pipelineName).toBe('New Patient Enquiries');
    expect(sheetExportRepository.ghlCandidatesByEmail).toHaveBeenCalledWith(ORG, 'jane@x.com');
    expect(sheetExportRepository.ghlCandidatesByPhone).not.toHaveBeenCalled();
  });

  it('2. phone-only hit: no email match, phone matches candidate stored differently formatted, service re-verifies canonical equality', async () => {
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([]);
    const c = contact({ id: 'ghl-2', email: 'someone-else@x.com', phone: '+447123456789' });
    sheetExportRepository.ghlCandidatesByPhone.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([lead({ contact_id: c.id })]);

    const dentally = { id: 'd-1', email: 'no-match@x.com', phone: '07123 456789' };
    const result = await findMatch(ORG, dentally);

    expect(result).not.toBeNull();
    expect(result.matchedContact).toEqual(c);
    expect(sheetExportRepository.ghlCandidatesByPhone).toHaveBeenCalledWith(ORG, '123456789');
  });

  it('2b. phone-only hit: candidate returned by RPC but canonical mismatch after re-verification is rejected', async () => {
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([]);
    const c = contact({ id: 'ghl-2', email: 'someone-else@x.com', phone: '+441111111111' });
    sheetExportRepository.ghlCandidatesByPhone.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([]);

    const dentally = { id: 'd-1', email: null, phone: '07123 456789' };
    const result = await findMatch(ORG, dentally);

    expect(result).toBeNull();
  });

  it('3a. ambiguity tiebreak: two candidates share email, only one has a pipeline lead -> that one wins', async () => {
    const withLead = contact({ id: 'ghl-A', created_at: '2026-01-01T00:00:00.000Z' });
    const withoutLead = contact({ id: 'ghl-B', created_at: '2026-06-01T00:00:00.000Z' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([withLead, withoutLead]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([lead({ contact_id: 'ghl-A' })]);

    const result = await findMatch(ORG, { id: 'd-1', email: withLead.email, phone: null });

    expect(result.matchedContact.id).toBe('ghl-A');
  });

  it('3b. ambiguity tiebreak: both candidates have leads -> most recently created contact wins', async () => {
    const older = contact({ id: 'ghl-A', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = contact({ id: 'ghl-B', created_at: '2026-06-01T00:00:00.000Z' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([older, newer]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([
      lead({ id: 'lead-A', contact_id: 'ghl-A' }),
      lead({ id: 'lead-B', contact_id: 'ghl-B' }),
    ]);

    const result = await findMatch(ORG, { id: 'd-1', email: older.email, phone: null });

    expect(result.matchedContact.id).toBe('ghl-B');
  });

  it('4. no pipeline lead on the matched contact -> null', async () => {
    const c = contact({ id: 'ghl-1' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([]);

    const result = await findMatch(ORG, { id: 'd-1', email: c.email, phone: null });

    expect(result).toBeNull();
  });

  it('5. earliest lead selection: leadCreatedAt + pipelineName come from the earliest lead', async () => {
    const c = contact({ id: 'ghl-1' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([
      lead({ id: 'lead-march', contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-march', created_at: '2026-03-01T00:00:00.000Z' }),
      lead({ id: 'lead-jan', contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-jan', created_at: '2026-01-15T00:00:00.000Z' }),
    ]);
    integrationAccountRepository.list.mockResolvedValue([
      { config: { pipelines: [{ id: 'pipe-jan', name: 'January Pipeline' }, { id: 'pipe-march', name: 'March Pipeline' }] } },
    ]);

    const result = await findMatch(ORG, { id: 'd-1', email: c.email, phone: null });

    expect(result.leadCreatedAt).toBe('2026-01-15T00:00:00.000Z');
    expect(result.pipelineName).toBe('January Pipeline');
  });

  it('6. unresolvable pipeline id falls back to the raw id, never blank', async () => {
    const c = contact({ id: 'ghl-1' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([c]);
    sheetExportRepository.pipelineLeads.mockResolvedValue([lead({ contact_id: 'ghl-1', ghl_pipeline_id: 'pipe-unknown' })]);
    integrationAccountRepository.list.mockResolvedValue([]);
    integrationRepository.getByProvider.mockResolvedValue(null);

    const result = await findMatch(ORG, { id: 'd-1', email: c.email, phone: null });

    expect(result.pipelineName).toBe('pipe-unknown');
  });

  it('7. no email and no phone -> null with zero repo calls', async () => {
    const result = await findMatch(ORG, { id: 'd-1', email: null, phone: null });

    expect(result).toBeNull();
    expect(sheetExportRepository.ghlCandidatesByEmail).not.toHaveBeenCalled();
    expect(sheetExportRepository.ghlCandidatesByPhone).not.toHaveBeenCalled();
    expect(sheetExportRepository.pipelineLeads).not.toHaveBeenCalled();
  });

  it('excludes self-match: candidate with the same id as the Dentally contact is never picked', async () => {
    const c = contact({ id: 'same-id' });
    sheetExportRepository.ghlCandidatesByEmail.mockResolvedValue([c]);

    const result = await findMatch(ORG, { id: 'same-id', email: c.email, phone: null });

    expect(result).toBeNull();
    expect(sheetExportRepository.pipelineLeads).not.toHaveBeenCalled();
  });
});

describe('pipelineNameMap', () => {
  it('falls back to the legacy integrations row when no integration_accounts pipelines exist', async () => {
    integrationAccountRepository.list.mockResolvedValue([]);
    integrationRepository.getByProvider.mockResolvedValue({ config: { pipelines: [{ id: 'p1', name: 'Legacy Pipeline' }] } });

    const map = await pipelineNameMap(ORG);

    expect(map.get('p1')).toBe('Legacy Pipeline');
  });
});
