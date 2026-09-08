// The Integrations panel's tick boxes, and whether the sync obeys them.
//
// Before this existed, `ad_accounts.is_selected` was written by the panel and
// read by nothing at all — `selectedAdAccountIds` had no callers, neither sync
// consulted it, and no report filtered on it. Three of the four orgs holding
// ad accounts were reporting on accounts they had explicitly excluded, one of
// them at 3.2x its true Meta spend.
import { describe, it, expect } from 'vitest';
import {
  applyAccountSelection, normaliseAccountId,
} from '../src/lib/integrations/ad-account-selection.js';

describe('normaliseAccountId', () => {
  it('strips the act_ prefix Meta uses on the wire but not in storage', () => {
    expect(normaliseAccountId('act_301734051601715')).toBe('301734051601715');
    expect(normaliseAccountId('301734051601715')).toBe('301734051601715');
  });

  it('strips the dashes Google shows in its console', () => {
    expect(normaliseAccountId('684-670-8190')).toBe('6846708190');
  });

  it('is total — a null id normalises rather than throwing', () => {
    expect(normaliseAccountId(null)).toBe('');
    expect(normaliseAccountId(undefined)).toBe('');
  });
});

describe('applyAccountSelection', () => {
  // The case that sent the user here: 1 of 4 ticked, 4 of 4 pulled.
  it('pulls only the ticked accounts', () => {
    const r = applyAccountSelection(
      ['1060844431253899', '301734051601715', '1383570195432993', '351760126308496'],
      ['301734051601715'],
    );
    expect(r.ids).toEqual(['301734051601715']);
    expect(r.excluded).toHaveLength(3);
    expect(r.warning).toBeNull();
  });

  // A first connect has discovered nothing, so nothing can have been ticked.
  // Pulling everything is what gives the owner a list to choose FROM; treating
  // "no rows" as "no selection" would make a fresh integration pull nothing.
  it('pulls everything when the org has no ad_accounts rows yet', () => {
    const r = applyAccountSelection(['a', 'b'], null);
    expect(r.ids).toEqual(['a', 'b']);
    expect(r.warning).toBeNull();
  });

  it('matches across the two id formats rather than filtering to nothing', () => {
    const r = applyAccountSelection(['act_123', '456'], ['123']);
    expect(r.ids).toEqual(['act_123']);
    expect(r.excluded).toEqual(['456']);
  });

  // Nothing ticked is a decision; the panel reads "0 of 4 included".
  it('pulls nothing, with a warning, when every account is unticked', () => {
    const r = applyAccountSelection(['a', 'b'], []);
    expect(r.ids).toEqual([]);
    expect(r.warning).toMatch(/all unticked/i);
  });

  // Ticked-but-unreachable is a FAULT, not a decision, and the two must not
  // read the same: one is the owner's choice, the other is a lost credential
  // or an id format that has drifted — and either would otherwise present as
  // a sync that ran clean and pulled nothing.
  it('distinguishes a selection that matches nothing from an empty selection', () => {
    const r = applyAccountSelection(['a', 'b'], ['zzz']);
    expect(r.ids).toEqual([]);
    expect(r.warning).toMatch(/none of the 1 included ad account/i);
    expect(r.warning).not.toMatch(/unticked/i);
  });

  it('never invents an account the credential cannot reach', () => {
    const r = applyAccountSelection(['a'], ['a', 'b']);
    expect(r.ids).toEqual(['a']);
  });
});
