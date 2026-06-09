// ============================================================================
// CRM B1 — Message Templates. Covers renderTemplate (pure) + crmTemplateService
// CRUD over a stubbed repository.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { renderTemplate, TEMPLATE_VARIABLES } from '../src/lib/crm-templates.js';

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    const out = renderTemplate('Hi {{first_name}}, your {{treatment}} at {{practice}}', {
      first_name: 'Sarah', treatment: 'Invisalign', practice: 'Ashford Dental',
    });
    expect(out).toBe('Hi Sarah, your Invisalign at Ashford Dental');
  });

  it('blanks unknown / missing variables', () => {
    const out = renderTemplate('Hi {{first_name}} {{unknown_var}}', { first_name: 'Sarah' });
    expect(out).toBe('Hi Sarah ');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ first_name }}', { first_name: 'Jo' })).toBe('Jo');
  });

  it('blanks placeholders of any case / shape so no raw {{token}} leaks', () => {
    expect(renderTemplate('Hi {{First_Name}} {{var2}}', {})).toBe('Hi  ');
  });

  it('leaves text without placeholders untouched', () => {
    expect(renderTemplate('No vars here', {})).toBe('No vars here');
  });

  it('exposes the supported variable catalogue', () => {
    expect(TEMPLATE_VARIABLES).toContain('first_name');
    expect(TEMPLATE_VARIABLES).toContain('treatment');
  });
});

// --- appended to backend/test/crm-templates.test.mjs -----------------------
import { crmTemplateService } from '../src/services/crmTemplate.service.js';
import { crmTemplateRepository } from '../src/repositories/crmTemplate.repository.js';

describe('crmTemplateService', () => {
  const ORG = 'org-1';
  let calls;

  beforeEach(() => {
    calls = {};
    crmTemplateRepository.list = async (orgId, opts) => {
      calls.list = { orgId, opts };
      return [{ id: 't1', organisation_id: orgId, channel: 'sms', name: 'Welcome', body: 'Hi' }];
    };
    crmTemplateRepository.create = async (row) => { calls.create = row; return { data: { id: 'new', ...row }, error: null }; };
    crmTemplateRepository.update = async (orgId, id, patch) => { calls.update = { orgId, id, patch }; return { data: { id, ...patch }, error: null }; };
    crmTemplateRepository.archive = async (orgId, id) => { calls.archive = { orgId, id }; return { data: { id, is_archived: true }, error: null }; };
  });

  it('list wraps rows under { templates } and forwards channel filter', async () => {
    const out = await crmTemplateService.list(ORG, { channel: 'sms' });
    expect(out.templates).toHaveLength(1);
    expect(calls.list).toEqual({ orgId: ORG, opts: { channel: 'sms' } });
  });

  it('create stamps organisation_id + created_by and returns the row', async () => {
    const out = await crmTemplateService.create(ORG, 'user-9', { channel: 'email', name: 'Prep', subject: 'S', body: 'B' });
    expect(calls.create.organisation_id).toBe(ORG);
    expect(calls.create.created_by).toBe('user-9');
    expect(out.id).toBe('new');
  });

  it('update forwards org + id + patch', async () => {
    const out = await crmTemplateService.update(ORG, 't1', { name: 'Renamed' });
    expect(calls.update).toEqual({ orgId: ORG, id: 't1', patch: { name: 'Renamed' } });
    expect(out.name).toBe('Renamed');
  });

  it('remove archives (soft delete) and returns success', async () => {
    const out = await crmTemplateService.remove(ORG, 't1');
    expect(calls.archive).toEqual({ orgId: ORG, id: 't1' });
    expect(out).toEqual({ success: true });
  });

  it('create throws AppError on repository error', async () => {
    crmTemplateRepository.create = async () => ({ data: null, error: { message: 'dup' } });
    await expect(crmTemplateService.create(ORG, 'u', { channel: 'sms', name: 'x', body: 'y' }))
      .rejects.toThrow('dup');
  });
});
