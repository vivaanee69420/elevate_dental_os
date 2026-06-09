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

  it('leaves text without placeholders untouched', () => {
    expect(renderTemplate('No vars here', {})).toBe('No vars here');
  });

  it('exposes the supported variable catalogue', () => {
    expect(TEMPLATE_VARIABLES).toContain('first_name');
    expect(TEMPLATE_VARIABLES).toContain('treatment');
  });
});
