// backend/test/features.catalog.test.mjs
// Pure feature catalog + resolution. org_features rows only OVERRIDE the code
// defaults; unknown DB keys must never grant anything (DB can't invent keys).
import { describe, it, expect } from 'vitest';
import {
  FEATURE_CATALOG, FEATURE_KEYS, defaultFeatures, resolveEffectiveFeatures,
} from '../src/lib/features.js';

describe('FEATURE_CATALOG', () => {
  it('has the four internal keys defaulting off and only module keys defaulting on', () => {
    for (const k of ['data_room', 'emergent', 'call_reporting', 'sheet_export']) {
      expect(FEATURE_CATALOG[k]).toMatchObject({ kind: 'internal', default: false });
    }
    for (const [k, v] of Object.entries(FEATURE_CATALOG)) {
      if (v.kind === 'module') expect(v.default).toBe(true);
      else expect(v.default).toBe(false);
      expect(FEATURE_KEYS).toContain(k);
    }
  });
  it('every module key names its sidebar section', () => {
    for (const v of Object.values(FEATURE_CATALOG)) {
      if (v.kind === 'module') expect(typeof v.navSection).toBe('string');
    }
  });
});

describe('resolveEffectiveFeatures', () => {
  it('returns catalog defaults for no rows / null', () => {
    expect(resolveEffectiveFeatures([])).toEqual(defaultFeatures());
    expect(resolveEffectiveFeatures(null)).toEqual(defaultFeatures());
    expect(defaultFeatures().data_room).toBe(false);
    expect(defaultFeatures().finance).toBe(true);
  });
  it('applies enable and disable overrides', () => {
    const f = resolveEffectiveFeatures([
      { feature: 'data_room', enabled: true },
      { feature: 'finance', enabled: false },
    ]);
    expect(f.data_room).toBe(true);
    expect(f.finance).toBe(false);
  });
  it('ignores unknown keys and non-boolean enabled', () => {
    const f = resolveEffectiveFeatures([
      { feature: 'made_up_key', enabled: true },
      { feature: 'emergent', enabled: 'yes' },
    ]);
    expect(f).not.toHaveProperty('made_up_key');
    expect(f.emergent).toBe(false);
  });
});
