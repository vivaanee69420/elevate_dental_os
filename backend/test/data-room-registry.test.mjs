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

  it('has the six sources in order', () => {
    expect(SOURCES.map((s) => s.key)).toEqual(['dentally', 'google-ads', 'meta-ads', 'gohighlevel', 'emergent', 'summaries']);
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
    expect(getDataset('dentally', 'appointments')?.table).toBe('data_room_dentally_appointments');
    expect(getDataset('dentally', 'nope')).toBeUndefined();
    expect(getDataset('nope', 'appointments')).toBeUndefined();
  });

  it('registryForClient exposes roster + pii flags and nothing internal', () => {
    const r = registryForClient();
    const dentally = r.sources.find((s) => s.key === 'dentally');
    const appts = dentally.datasets.find((d) => d.key === 'appointments');
    expect(appts.roster).toBe(false);
    expect(appts.columns.find((c) => c.col === 'id')).toEqual({ col: 'id', pii: false, derived: false, unit: 'id', description: expect.any(String) });
    const patients = dentally.datasets.find((d) => d.key === 'patients');
    expect(patients.roster).toBe(false); // dated on created_at (Data Room universal date filter)
    const staff = dentally.datasets.find((d) => d.key === 'staff');
    expect(staff.roster).toBe(true);
    expect(patients.columns.find((c) => c.col === 'email')).toEqual({ col: 'email', pii: true, derived: false, unit: 'text', description: expect.any(String) });
    expect(appts.table).toBeUndefined();
    expect(appts.where).toBeUndefined();
  });
});

describe('derived columns + views', () => {
  it('dentally/appointments reads the view and exposes the rule columns', () => {
    const ds = getDataset('dentally', 'appointments');
    expect(ds.table).toBe('data_room_dentally_appointments');
    const derived = ds.columns.filter((c) => c.derived).map((c) => c.col);
    expect(derived).toEqual(['is_patient_appointment', 'occurred', 'dna', 'cancelled', 'duration_mins', 'practitioner_name']);
    expect(ds.columns.find((c) => c.col === 'occurred')).toMatchObject({ derived: true, unit: 'flag' });
  });
  it('patients gets a pseudonymous key that is NOT pii', () => {
    const ds = getDataset('dentally', 'patients');
    expect(ds.table).toBe('data_room_dentally_patients');
    expect(ds.columns.find((c) => c.col === 'patient_key')).toMatchObject({ derived: true, pii: undefined, unit: 'hash' });
    expect(ds.columns.map((c) => c.col)).toEqual(expect.arrayContaining(['birth_year', 'postcode_district']));
  });
  it('opportunities exposes pipeline_name + outcome; both ads datasets read data_room_ad_metrics', () => {
    expect(getDataset('gohighlevel', 'opportunities').columns.map((c) => c.col)).toEqual(expect.arrayContaining(['pipeline_name', 'outcome']));
    expect(getDataset('google-ads', 'campaign_daily').table).toBe('data_room_ad_metrics');
    expect(getDataset('meta-ads', 'campaign_daily').table).toBe('data_room_ad_metrics');
    expect(getDataset('google-ads', 'campaign_daily').where).toEqual({ provider: 'google_ads' });
  });
  it('every column carries a unit and a description', () => {
    for (const ds of DATASETS) for (const c of ds.columns) {
      expect(c.unit, `${ds.source}/${ds.key}.${c.col}`).toBeTruthy();
      expect(c.description, `${ds.source}/${ds.key}.${c.col}`).toBeTruthy();
    }
  });
});

describe('summaries source', () => {
  it('registers practice_day and practice_month as rpc datasets', () => {
    expect(SOURCES.map((s) => s.key)).toContain('summaries');
    const day = getDataset('summaries', 'practice_day');
    expect(day).toMatchObject({ derived: 'rpc', rpc: 'data_room_practice_day', dateCol: 'day', dateType: 'date' });
    const month = getDataset('summaries', 'practice_month');
    expect(month).toMatchObject({ derived: 'rpc', rpc: 'data_room_practice_month', dateCol: 'month', dateType: 'date' });
    expect(month.columns.map((c) => c.col)).toEqual(expect.arrayContaining(['dna_pct', 'financial_revenue_pence']));
  });
  it('client shape flags summary datasets and derived columns', () => {
    const src = registryForClient().sources.find((s) => s.key === 'summaries');
    expect(src.datasets.map((d) => d.summary)).toEqual([true, true]);
    const appt = registryForClient().sources.find((s) => s.key === 'dentally').datasets.find((d) => d.key === 'appointments');
    expect(appt.summary).toBe(false);
    expect(appt.columns.find((c) => c.col === 'occurred')).toEqual({ col: 'occurred', pii: false, derived: true, unit: 'flag', description: expect.stringMatching(/completed/) });
  });
  it('validateRegistry still returns []', () => {
    expect(validateRegistry()).toEqual([]);
  });
});
