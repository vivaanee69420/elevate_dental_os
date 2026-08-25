// ============================================================================
// Data Room CSV encoder — pure. RFC 4180 quoting, CRLF line endings, UTF-8
// BOM so Excel opens the file with the right encoding. No I/O here.
// ============================================================================

export const BOM = '﻿';

const NEEDS_QUOTES = /[",\r\n]/;

/** One CSV field. null/undefined -> '', objects -> JSON text, Dates -> ISO. */
export function csvField(v) {
    if (v === null || v === undefined) return '';
    let s;
    if (v instanceof Date) s = v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV record, CRLF-terminated. */
export function csvLine(values) {
    return values.map(csvField).join(',') + '\r\n';
}

/** Rows -> CSV body (no header). Missing keys emit an empty field. */
export function rowsToCsv(columns, rows) {
    let out = '';
    for (const row of rows) out += csvLine(columns.map((c) => row[c]));
    return out;
}
