import { describe, it, expect } from 'vitest';
import { inferUnit, docFor, COLUMN_DOCS } from '../src/lib/data-room/dictionary.js';
import { DATASETS } from '../src/lib/data-room/registry.js';

describe('inferUnit', () => {
  it('maps by suffix/prefix', () => {
    expect(inferUnit('spend_pence')).toBe('pence');
    expect(inferUnit('created_at')).toBe('timestamptz');
    expect(inferUnit('invoiced_on')).toBe('date');
    expect(inferUnit('metric_date')).toBe('date');
    expect(inferUnit('practice_id')).toBe('id');
    expect(inferUnit('id')).toBe('id');
    expect(inferUnit('patient_key')).toBe('hash');
    expect(inferUnit('is_settled')).toBe('flag');
    expect(inferUnit('dna_pct')).toBe('percent');
    expect(inferUnit('treatment_name')).toBe('text');
  });
});

describe('docFor', () => {
  it('uses the dataset override before the global doc', () => {
    const ds = { source: 'dentally', key: 'appointments' };
    expect(docFor(ds, 'status').description).toMatch(/scheduled|completed|no_show/);
    expect(docFor({ source: 'gohighlevel', key: 'opportunities' }, 'status').description).toMatch(/pipeline|stage/i);
  });
  it('lets a doc override the inferred unit', () => {
    expect(docFor({ source: 'dentally', key: 'treatment_items' }, 'duration').unit).toBe('minutes');
    expect(docFor({ source: 'emergent', key: 'daily_cashups' }, 'chair_utilisation').unit).toBe('percent');
  });
  it('returns an empty description for an unknown column (validator catches it)', () => {
    expect(docFor({ source: 'dentally', key: 'patients' }, 'no_such_column')).toEqual({ unit: 'text', description: '' });
  });
  it('documents every column of every registered dataset', () => {
    const missing = [];
    for (const ds of DATASETS) for (const c of ds.columns) if (!docFor(ds, c.col).description) missing.push(`${ds.source}/${ds.key}.${c.col}`);
    expect(missing).toEqual([]);
  });
  it('every global doc is British English and ends with a full stop', () => {
    for (const [col, d] of Object.entries(COLUMN_DOCS)) {
      expect(d.description, col).toMatch(/\.$/);
      expect(d.description, col).not.toMatch(/\b(organization|color|optimize)\b/i);
    }
  });
});
