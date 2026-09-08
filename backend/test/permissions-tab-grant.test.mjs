// Granting a TAB has to grant the data behind it.
//
// The Team screen grants a tab at a time and writes only page:<id> keys; every
// API gate reads the SECTION key. So ticking a tab put it in someone's nav and
// left the section key false, and the page rendered and then answered
// "Insufficient permissions" to every request it made — reported by the owner
// as "I gave the permission and it says insufficient permission".
import { describe, it, expect } from 'vitest';
import {
  resolveEffectivePermissions, defaultPermissionsForRole, pageKey, PAGE_SECTION,
} from '../src/lib/permissions.js';

const analyst = (overrides) => resolveEffectivePermissions([], overrides, 'analyst');

describe('a granted tab carries its section key', () => {
  it('opens the API for the section the tab belongs to', () => {
    const p = analyst({ [pageKey('call-reporting')]: true });
    expect(p[pageKey('call-reporting')]).toBe(true);
    // The key every gate for that page actually reads.
    expect(p[PAGE_SECTION['call-reporting']]).toBe(true);
  });

  // Granting ONE tab must not light up the whole section in the nav — that is
  // the opposite of what the owner ticked, and is why the section key is
  // raised after the page values, never before.
  it('does not turn on the other tabs in that section', () => {
    const p = analyst({ [pageKey('call-reporting')]: true });
    const siblings = Object.entries(PAGE_SECTION)
      .filter(([id, key]) => key === PAGE_SECTION['call-reporting'] && id !== 'call-reporting');
    expect(siblings.length).toBeGreaterThan(0);
    for (const [id] of siblings) {
      expect(p[pageKey(id)], `page:${id} must stay off`).toBe(false);
    }
  });

  it('a tab switched OFF still turns nothing on', () => {
    const p = analyst({ [pageKey('call-reporting')]: false });
    expect(p[pageKey('call-reporting')]).toBe(false);
    expect(p[PAGE_SECTION['call-reporting']]).toBe(false);
  });

  // Denying a tab inside a section the person otherwise holds must keep
  // working — the override is the finer instrument and still wins on the page.
  it('keeps a per-tab denial inside a granted section', () => {
    const p = resolveEffectivePermissions(
      [{ permission_key: 'growth.view', allowed: true }],
      { [pageKey('call-reporting')]: false },
      'analyst',
    );
    expect(p['growth.view']).toBe(true);
    expect(p[pageKey('call-reporting')]).toBe(false);
  });

  it('changes nothing for a role that was already granted the section', () => {
    const before = defaultPermissionsForRole('practice_manager');
    const after = analyst({});
    expect(before['growth.view']).toBe(true);
    // An analyst with no grants still holds nothing but their own default.
    expect(after['growth.view']).toBe(false);
    expect(after['data.export']).toBe(true);
  });

  // Reception is CRM only (project rule 5). Nothing here may reach past that
  // without the owner explicitly ticking a tab outside it.
  it('never widens a role on its own', () => {
    const p = defaultPermissionsForRole('reception');
    expect(p['crm.view']).toBe(true);
    expect(p['finance.view']).toBe(false);
    expect(p['growth.view']).toBe(false);
    expect(p['system.manage']).toBe(false);
  });
});
