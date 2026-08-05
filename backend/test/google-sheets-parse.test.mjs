// Google Sheets parse helpers (Call Reporting v2) — date+time combining in the
// sheet's timezone (DST-correct), MM/DD/YYYY text fallback, Yes/No buckets,
// page parsing and content hashing. Serial anchor: 25569 = 1970-01-01.
// Serial for 2026-07-31 (BST) = 46234; 14:00 = 0.5833333333333334.
import './setup.js';
import { describe, it, expect } from 'vitest';
import {
  colLetter, combineDateTime, parseDateWallMs, parseTimeOfDayMs, parseYesNo,
  parsePage, hashRow, MAPPED_FIELDS,
} from '../src/lib/integrations/google-sheets-sync.js';

const TZ = 'Europe/London';

describe('colLetter', () => {
  it('maps 0->A, 25->Z, 26->AA, 27->AB', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
  });
});

describe('combineDateTime', () => {
  it('serial date + serial time, summer (BST = UTC+1)', () => {
    expect(combineDateTime(46234, 0.5833333333333334, TZ)).toBe('2026-07-31T13:00:00.000Z');
  });
  it('serial date + no time = midnight wall time', () => {
    expect(combineDateTime(46234, '', TZ)).toBe('2026-07-30T23:00:00.000Z');
  });
  it('a full datetime serial in the date column floors to midnight (time col re-adds)', () => {
    expect(combineDateTime(46234.9, 0.5, TZ)).toBe('2026-07-31T11:00:00.000Z');
  });
  it('MM/DD/YYYY text + hh:mm text, summer', () => {
    expect(combineDateTime('07/31/2026', '14:05', TZ)).toBe('2026-07-31T13:05:00.000Z');
  });
  it('MM/DD/YYYY text + hh:mm text, winter (GMT = UTC+0)', () => {
    expect(combineDateTime('01/15/2026', '09:00', TZ)).toBe('2026-01-15T09:00:00.000Z');
  });
  it('am/pm times', () => {
    expect(combineDateTime('07/31/2026', '2:05 pm', TZ)).toBe('2026-07-31T13:05:00.000Z');
    expect(combineDateTime('07/31/2026', '12:10 AM', TZ)).toBe('2026-07-30T23:10:00.000Z');
  });
  it('ISO yyyy-mm-dd text dates also accepted', () => {
    expect(combineDateTime('2026-07-31', '10:00', TZ)).toBe('2026-07-31T09:00:00.000Z');
  });
  it('unparsable date -> null (row will be skipped)', () => {
    expect(combineDateTime('soon', '10:00', TZ)).toBeNull();
    expect(combineDateTime('', '10:00', TZ)).toBeNull();
    expect(combineDateTime('31/07/2026', '10:00', TZ)).toBeNull(); // dd/mm is NOT accepted: month 31 invalid
  });
  it('unparsable time falls back to midnight, does not lose the lead', () => {
    expect(combineDateTime('01/15/2026', 'later', TZ)).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('parseDateWallMs / parseTimeOfDayMs', () => {
  it('serial 25569 = 1970-01-01 midnight wall', () => {
    expect(parseDateWallMs(25569)).toBe(0);
  });
  it('time serial 0.5 = 12:00', () => {
    expect(parseTimeOfDayMs(0.5)).toBe(43200000);
  });
  it('time text 09:30:15', () => {
    expect(parseTimeOfDayMs('09:30:15')).toBe(((9 * 60 + 30) * 60 + 15) * 1000);
  });
});

describe('parseYesNo', () => {
  it.each([['Yes'], ['yes'], [' YES '], ['y'], ['TRUE'], ['true'], ['1'], [true]])('%s -> true', (v) => {
    expect(parseYesNo(v)).toBe(true);
  });
  it.each([['No'], ['no'], [''], [null], [undefined], ['maybe'], [false], [0]])('%s -> false', (v) => {
    expect(parseYesNo(v)).toBe(false);
  });
});

describe('parsePage', () => {
  const columns = {
    date:          [46234,   '07/31/2026', 'garbage', ''],
    created_time:  [0.375,   '16:45',      '10:00',   ''],
    called_3m:     ['Yes',   'No',         'Yes',     ''],
    called_10m:    ['No',    'Yes',        'No',      ''],
    pipeline_name: ['Facebook Ads', '',    'Google',  ''],
  };
  it('parses good rows, skips bad dates, ignores fully-empty rows', () => {
    const { rows, skipped, lastDataRow } = parsePage(columns, 2, TZ);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);          // the 'garbage' date row
    expect(lastDataRow).toBe(4);      // row 4 held data (bad date still counts as data)
    expect(rows[0]).toMatchObject({
      sheet_row_index: 2,
      created_at: '2026-07-31T08:00:00.000Z', // 09:00 BST
      called_3m: true, called_10m: false, pipeline_name: 'Facebook Ads',
    });
    expect(rows[1]).toMatchObject({
      sheet_row_index: 3,
      created_at: '2026-07-31T15:45:00.000Z', // 16:45 BST
      called_3m: false, called_10m: true, pipeline_name: null,
    });
  });
  it('row_hash changes when a bucket flips, stable otherwise', () => {
    const a = parsePage(columns, 2, TZ).rows[0];
    const b = parsePage({ ...columns, called_3m: ['No', 'No', 'Yes', ''] }, 2, TZ).rows[0];
    const again = parsePage(columns, 2, TZ).rows[0];
    expect(a.row_hash).not.toBe(b.row_hash);
    expect(a.row_hash).toBe(again.row_hash);
  });
  it('MAPPED_FIELDS is exactly the five stored columns', () => {
    expect(MAPPED_FIELDS).toEqual(['date', 'created_time', 'called_3m', 'called_10m', 'pipeline_name']);
  });
  it('hashRow covers exactly the four stored values', () => {
    const f = { created_at: '2026-07-31T08:00:00.000Z', called_3m: true, called_10m: false, pipeline_name: 'X' };
    expect(hashRow(f)).toBe(hashRow({ ...f }));
    expect(hashRow(f)).not.toBe(hashRow({ ...f, pipeline_name: 'Y' }));
  });
});
