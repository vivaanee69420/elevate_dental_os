// backend/test/data-room-xlsx.test.mjs
// ============================================================================
// Data Room Excel writer — sheet naming rules (Excel-safe, <=31, unique) and
// the typed-cell contract (Date cells, booleans, JSON text, and a £ neighbour
// column for every `pence` column). Round-trips a real streamed workbook.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import './setup.js';
import { sheetName, openWorkbook } from '../src/lib/data-room/xlsx.js';

async function collect(stream) {
  const bufs = [];
  for await (const b of stream) bufs.push(b);
  return Buffer.concat(bufs);
}

describe('sheetName', () => {
  it('strips forbidden characters, truncates to 31 and de-duplicates', () => {
    const used = new Set();
    expect(sheetName('Ashford: Main [Street] / Surgery?*', used)).toBe('Ashford Main Street  Surgery');
    // The de-duplicated name still has to fit Excel's 31-char limit, so the
    // base is trimmed to make room for the ' (2)' suffix.
    expect(sheetName('Ashford: Main [Street] / Surgery?*', used)).toBe('Ashford Main Street  Surger (2)');
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(sheetName('', used)).toBe('Sheet');
  });
});

describe('openWorkbook', () => {
  it('writes one sheet per addSheet with typed cells and a £ neighbour for pence columns', async () => {
    const out = new PassThrough();
    const done = collect(out);
    const wb = openWorkbook(out);
    const s = wb.addSheet('Ashford', [
      { col: 'id', unit: 'id' }, { col: 'starts_at', unit: 'timestamptz' }, { col: 'invoiced_on', unit: 'date' },
      { col: 'fee_pence', unit: 'pence' }, { col: 'occurred', unit: 'flag' }, { col: 'meta', unit: 'text' },
    ]);
    s.addRow({ id: 'r1', starts_at: '2026-08-01T09:30:00.000Z', invoiced_on: '2026-08-01', fee_pence: 12345, occurred: true, meta: { a: 1 } });
    s.commit();
    const t = wb.addSheet('Bexley', [{ col: 'id', unit: 'id' }]);
    t.addRow({ id: 'r2' });
    t.commit();
    await wb.finish();

    const buf = await done;
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buf);
    expect(read.worksheets.map((w) => w.name)).toEqual(['Ashford', 'Bexley']);
    const ws = read.getWorksheet('Ashford');
    expect(ws.getRow(1).values.slice(1)).toEqual(['id', 'starts_at', 'invoiced_on', 'fee_pence', 'fee_gbp', 'occurred', 'meta']);
    const r = ws.getRow(2);
    expect(r.getCell(2).value).toBeInstanceOf(Date);
    expect(r.getCell(3).value).toBeInstanceOf(Date);
    expect(r.getCell(4).value).toBe(12345);
    expect(r.getCell(5).value).toBe(123.45);
    expect(r.getCell(5).numFmt).toBe('£#,##0.00');
    expect(r.getCell(6).value).toBe(true);
    expect(r.getCell(7).value).toBe('{"a":1}');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
