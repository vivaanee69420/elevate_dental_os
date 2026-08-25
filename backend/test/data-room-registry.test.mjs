// backend/test/data-room-registry.test.mjs
import { describe, it, expect } from 'vitest';
import {
  DATASETS, SOURCES, getDataset, registryForClient, validateRegistry,
  FORBIDDEN_COLUMNS, PII_COLUMNS,
} from '../src/lib/data-room/registry.js';

const VIA_TABLES = new Set(['ad_accounts', 'integration_accounts']);

describe('registry invariants', () => {
  it('validateRegistry reports no problems', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('has the five sources in order', () => {
    expect(SOURCES.map((s) => s.key)).toEqual(['dentally', 'google-ads', 'meta-ads', 'gohighlevel', 'emergent']);
  });

  it('every dataset belongs to a known source and (source,key) is unique', () => {
    const seen = new Set();
    for (const d of DATASETS) {
      expect(SOURCES.some((s) => s.key === d.source)).toBe(true);
      const k = `${d.source}/${d.key}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('every dataset has a table, non-empty columns, and a practice strategy', () => {
    for (const d of DATASETS) {
      expect(typeof d.table).toBe('string');
      expect(d.columns.length).toBeGreaterThan(0);
      const hasCol = !!d.practice?.col;
      const hasVia = !!d.practice?.via && VIA_TABLES.has(d.practice.via.table);
      expect(hasCol || hasVia).toBe(true);
    }
  });

  it('dateCol, when set, is one of the columns', () => {
    for (const d of DATASETS) {
      if (d.dateCol) expect(d.columns.map((c) => c.col)).toContain(d.dateCol);
    }
  });

  it('never exposes a forbidden column and never lists organisation_id', () => {
    for (const d of DATASETS) {
      for (const c of d.columns) {
        expect(FORBIDDEN_COLUMNS.has(c.col)).toBe(false);
        expect(c.col).not.toBe('organisation_id');
      }
    }
  });

  it('flags every PII column, except staff email/phone on associates/staff', () => {
    for (const d of DATASETS) {
      for (const c of d.columns) {
        if (!PII_COLUMNS.has(c.col)) continue;
        const staffContact = (d.table === 'associates' || d.table === 'staff') && (c.col === 'email' || c.col === 'phone');
        if (staffContact) expect(c.pii).toBeUndefined();
        else expect(c.pii).toBe(true);
      }
    }
  });

  it('spec datasets exist', () => {
    const keys = DATASETS.map((d) => `${d.source}/${d.key}`);
    for (const k of [
      'dentally/patients', 'dentally/appointments', 'dentally/payments', 'dentally/invoices',
      'dentally/invoice_items', 'dentally/treatment_plans', 'dentally/treatment_items',
      'dentally/practitioners', 'dentally/staff',
      'google-ads/accounts', 'google-ads/campaign_daily',
      'meta-ads/accounts', 'meta-ads/campaign_daily',
      'gohighlevel/subaccounts', 'gohighlevel/pipelines', 'gohighlevel/contacts',
      'gohighlevel/opportunities', 'gohighlevel/conversations', 'gohighlevel/appointments',
      'emergent/treatments_accepted', 'emergent/daily_cashups', 'emergent/monthly_pl',
    ]) expect(keys).toContain(k);
  });

  it('getDataset resolves and returns undefined for unknown', () => {
    expect(getDataset('dentally', 'appointments')?.table).toBe('appointments');
    expect(getDataset('dentally', 'nope')).toBeUndefined();
    expect(getDataset('nope', 'appointments')).toBeUndefined();
  });

  it('registryForClient exposes roster + pii flags and nothing internal', () => {
    const r = registryForClient();
    const dentally = r.sources.find((s) => s.key === 'dentally');
    const appts = dentally.datasets.find((d) => d.key === 'appointments');
    expect(appts.roster).toBe(false);
    expect(appts.columns.find((c) => c.col === 'id')).toEqual({ col: 'id', pii: false });
    const patients = dentally.datasets.find((d) => d.key === 'patients');
    expect(patients.roster).toBe(false); // dated on created_at (Data Room universal date filter)
    const staff = dentally.datasets.find((d) => d.key === 'staff');
    expect(staff.roster).toBe(true);
    expect(patients.columns.find((c) => c.col === 'email')).toEqual({ col: 'email', pii: true });
    expect(appts.table).toBeUndefined();
    expect(appts.where).toBeUndefined();
  });
});
