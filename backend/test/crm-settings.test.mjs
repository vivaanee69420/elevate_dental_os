// ============================================================================
// CRM B2 — Settings. Covers crmSettingsService get/update over a stubbed
// repository: first-read seeding, aggregator counts, defensive sequence count.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { crmSettingsService, DEFAULT_SETTINGS } from '../src/services/crmSettings.service.js';
import { crmSettingsRepository } from '../src/repositories/crmSettings.repository.js';

describe('crmSettingsService', () => {
  const ORG = 'org-1';
  let calls;

  beforeEach(() => {
    calls = {};
    crmSettingsRepository.get = async (orgId) => { calls.get = orgId; return calls.row ?? null; };
    crmSettingsRepository.upsert = async (orgId, patch) => {
      calls.upsert = { orgId, patch };
      return { data: { organisation_id: orgId, ...patch }, error: null };
    };
    crmSettingsRepository.templateCount = async () => 4;
    crmSettingsRepository.activeSequenceCount = async () => 2;
  });

  it('seeds defaults on first read (no row) and persists them', async () => {
    calls.row = null;
    const out = await crmSettingsService.get(ORG);
    expect(calls.upsert.orgId).toBe(ORG);
    expect(calls.upsert.patch).toEqual(DEFAULT_SETTINGS);
    expect(out.settings.treatments).toHaveLength(6);
  });

  it('does not re-seed when a row already exists', async () => {
    calls.row = { organisation_id: ORG, treatments: [{ name: 'X', default_value_pence: 100 }], sources: ['Web'] };
    const out = await crmSettingsService.get(ORG);
    expect(calls.upsert).toBeUndefined();
    expect(out.settings.sources).toEqual(['Web']);
  });

  it('returns aggregator counts derived from siblings + the settings row', async () => {
    calls.row = { organisation_id: ORG, treatments: [{ name: 'A', default_value_pence: 1 }, { name: 'B', default_value_pence: 2 }], sources: ['Web', 'Meta', 'Google'] };
    const out = await crmSettingsService.get(ORG);
    expect(out.counts).toEqual({
      template_count: 4,
      active_sequence_count: 2,
      treatment_count: 2,
      source_count: 3,
    });
  });

  it('seeded defaults carry pence treatment values', () => {
    const allOn4 = DEFAULT_SETTINGS.treatments.find((t) => t.name === 'All-on-4 Implants');
    expect(allOn4.default_value_pence).toBe(1450000);
  });

  it('update stamps updated_by and upserts the patch', async () => {
    const out = await crmSettingsService.update(ORG, 'user-9', { marketing_default_consent: true });
    expect(calls.upsert.patch.updated_by).toBe('user-9');
    expect(calls.upsert.patch.marketing_default_consent).toBe(true);
    expect(out.settings.marketing_default_consent).toBe(true);
  });

  it('update throws AppError on repository error', async () => {
    crmSettingsRepository.upsert = async () => ({ data: null, error: { message: 'bad' } });
    await expect(crmSettingsService.update(ORG, 'u', { quiet_hours_tz: 'UTC' })).rejects.toThrow('bad');
  });
});
