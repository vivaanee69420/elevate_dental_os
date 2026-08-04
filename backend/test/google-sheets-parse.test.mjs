// Pure-helper coverage for the Google Sheets (Call Reporting) sync:
// URL parsing, A1 column letters, serial/text timestamp conversion (incl.
// London DST), page parsing (empty rows, unparseable created_at) and row
// hashing (change detection).
import './setup.js';
import { describe, it, expect } from 'vitest';
import { parseSpreadsheetId } from '../src/lib/integrations/google-sheets-provider.js';
import {
  colLetter, serialToIso, parseTextTimestamp, parseTimestampValue,
  parsePage, hashRow,
} from '../src/lib/integrations/google-sheets-sync.js';

describe('parseSpreadsheetId', () => {
  it('extracts the id from a full Sheets URL', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC_d-EfGhIjK123/edit#gid=0'))
      .toBe('1AbC_d-EfGhIjK123');
  });
  it('accepts a bare id', () => {
    expect(parseSpreadsheetId('1AbC_d-EfGhIjK123')).toBe('1AbC_d-EfGhIjK123');
  });
  it('rejects junk', () => {
    expect(parseSpreadsheetId('not a sheet')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
    expect(parseSpreadsheetId('https://example.com/evil')).toBeNull();
  });
});

describe('colLetter', () => {
  it('maps 0-based indexes to A1 letters', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
    expect(colLetter(51)).toBe('AZ');
    expect(colLetter(52)).toBe('BA');
  });
});

// Serial for a wall-clock instant: days since 1899-12-30 (25569 = Unix epoch).
function serialFor(utcWallMs) {
  return utcWallMs / 86400000 + 25569;
}

describe('timestamp parsing', () => {
  it('converts a summer serial using BST (UTC+1)', () => {
    const serial = serialFor(Date.UTC(2026, 7, 1, 12, 0, 0)); // 1 Aug 2026 12:00 wall
    expect(serialToIso(serial, 'Europe/London')).toBe('2026-08-01T11:00:00.000Z');
  });
  it('converts a winter serial as UTC', () => {
    const serial = serialFor(Date.UTC(2026, 0, 15, 12, 0, 0)); // 15 Jan 2026 12:00 wall
    expect(serialToIso(serial, 'Europe/London')).toBe('2026-01-15T12:00:00.000Z');
  });
  it('rejects non-numeric serials', () => {
    expect(serialToIso('abc')).toBeNull();
    expect(serialToIso(NaN)).toBeNull();
  });
  it('parses British dd/mm/yyyy hh:mm text', () => {
    expect(parseTextTimestamp('01/08/2026 14:30', 'Europe/London')).toBe('2026-08-01T13:30:00.000Z');
  });
  it('parses date-only text as midnight wall time', () => {
    expect(parseTextTimestamp('15/01/2026', 'Europe/London')).toBe('2026-01-15T00:00:00.000Z');
  });
  it('parses ISO-ish text', () => {
    expect(parseTextTimestamp('2026-08-01 14:30:05', 'Europe/London')).toBe('2026-08-01T13:30:05.000Z');
  });
  it('returns null for garbage', () => {
    expect(parseTextTimestamp('yesterday')).toBeNull();
    expect(parseTimestampValue('')).toBeNull();
    expect(parseTimestampValue(null)).toBeNull();
  });
});

describe('parsePage', () => {
  const tz = 'Europe/London';
  const s = (y, mo, d, h = 0, mi = 0) => serialFor(Date.UTC(y, mo, d, h, mi));

  it('parses rows, skips unparseable created_at, tracks lastDataRow', () => {
    const columns = {
      practice: ['Rochester', 'Gillingham', 'Rochester'],
      created_at: [s(2026, 7, 1, 9, 0), 'not-a-date', s(2026, 7, 1, 10, 0)],
      first_call_at: [s(2026, 7, 1, 9, 2), '', ''],
      source: ['Facebook Ads', 'Google', 'Facebook Ads'],
      pipeline_status: ['New', 'New', ''],
    };
    const { rows, skipped, lastDataRow } = parsePage(columns, 2, tz);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(lastDataRow).toBe(4);
    expect(rows[0]).toMatchObject({
      sheet_row_index: 2,
      practice_value: 'Rochester',
      created_at: '2026-08-01T08:00:00.000Z',
      first_call_at: '2026-08-01T08:02:00.000Z',
      lead_source: 'Facebook Ads',
      pipeline_status: 'New',
    });
    expect(rows[1].first_call_at).toBeNull();
    expect(rows[1].pipeline_status).toBeNull();
  });

  it('skips fully-empty rows without counting them as skipped', () => {
    const columns = {
      practice: ['', 'Rochester'],
      created_at: ['', s(2026, 7, 1, 9, 0)],
      first_call_at: ['', ''],
      source: ['', ''],
      pipeline_status: ['', ''],
    };
    const { rows, skipped } = parsePage(columns, 2, tz);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(0);
    expect(rows[0].sheet_row_index).toBe(3);
  });

  it('handles ragged columns (shorter arrays) by padding', () => {
    const columns = {
      practice: ['Rochester', 'Gillingham'],
      created_at: [s(2026, 7, 1, 9, 0), s(2026, 7, 1, 10, 0)],
      first_call_at: [s(2026, 7, 1, 9, 1)],   // second row not yet called
      source: ['Google'],
      pipeline_status: [],
    };
    const { rows } = parsePage(columns, 10, tz);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ sheet_row_index: 11, first_call_at: null, lead_source: null });
  });
});

describe('hashRow', () => {
  const base = {
    practice_value: 'Rochester',
    created_at: '2026-08-01T08:00:00.000Z',
    first_call_at: null,
    lead_source: 'Facebook Ads',
    pipeline_status: 'New',
  };
  it('is stable for identical fields', () => {
    expect(hashRow({ ...base })).toBe(hashRow({ ...base }));
    expect(hashRow(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when first_call_at is filled in (edit detection)', () => {
    expect(hashRow({ ...base, first_call_at: '2026-08-01T08:05:00.000Z' })).not.toBe(hashRow(base));
  });
});
