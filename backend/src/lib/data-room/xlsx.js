// backend/src/lib/data-room/xlsx.js
// ============================================================================
// Data Room Excel writer — a thin wrapper over exceljs's streaming
// WorkbookWriter. One worksheet per addSheet(); rows are committed as they
// are written so memory stays flat for large exports. No I/O of its own: the
// caller hands in the writable (Express `res` in prod, a PassThrough in
// tests). Cell typing follows the dictionary unit:
//   pence       -> integer cell + a `<col>_gbp` neighbour (£#,##0.00)
//   date        -> Date (midnight UTC)      timestamptz -> Date + hh:mm format
//   flag        -> boolean                  object      -> JSON text
// ============================================================================
import ExcelJS from 'exceljs';

const FORBIDDEN = /[[\]:*?/\\]/g;
const GBP_FMT = '£#,##0.00';
// Excel renders a bare timestamp as a date and hides the time; be explicit.
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';

/** Excel-safe, <=31 chars, unique within `used` (mutated). */
export function sheetName(raw, used) {
    const base = String(raw ?? '').replace(FORBIDDEN, '').trim().slice(0, 31) || 'Sheet';
    let name = base;
    let n = 2;
    while (used.has(name)) {
        const suffix = ` (${n++})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name);
    return name;
}

function cell(unit, v) {
    if (v === null || v === undefined) return null;
    switch (unit) {
        case 'date':
        case 'timestamptz': {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? String(v) : d;
        }
        case 'flag': return typeof v === 'boolean' ? v : String(v);
        default:
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
    }
}

export function openWorkbook(stream) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const used = new Set();
    return {
        addSheet(name, columns) {
            const ws = workbook.addWorksheet(sheetName(name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
            const header = [];
            const plan = []; // { key, unit } — unit 'gbp' marks the derived £ neighbour
            for (const c of columns) {
                header.push(c.col);
                plan.push({ key: c.col, unit: c.unit });
                if (c.unit === 'pence') {
                    const gbp = c.col.endsWith('_pence') ? `${c.col.slice(0, -6)}_gbp` : `${c.col}_gbp`;
                    header.push(gbp);
                    plan.push({ key: c.col, unit: 'gbp' });
                }
            }
            // `ws.columns = …` populates row 1 from the `header` fields without
            // writing it, so row 1 can still be styled; committing it here IS
            // the header write (every later addRow() is row 2 onwards).
            ws.columns = header.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
            ws.getRow(1).font = { bold: true };
            ws.getRow(1).commit();
            // Cell number formats, resolved once per sheet: [1-based index, format].
            const formats = [];
            plan.forEach((p, i) => {
                if (p.unit === 'gbp') formats.push([i + 1, GBP_FMT]);
                else if (p.unit === 'timestamptz') formats.push([i + 1, DATETIME_FMT]);
            });
            return {
                addRow(row) {
                    const values = plan.map((p) => {
                        if (p.unit === 'gbp') {
                            const v = row[p.key];
                            return typeof v === 'number' ? v / 100 : null;
                        }
                        return cell(p.unit, row[p.key]);
                    });
                    const r = ws.addRow(values);
                    for (const [i, fmt] of formats) r.getCell(i).numFmt = fmt;
                    r.commit();
                },
                commit() { ws.commit(); },
            };
        },
        async finish() { await workbook.commit(); },
    };
}
