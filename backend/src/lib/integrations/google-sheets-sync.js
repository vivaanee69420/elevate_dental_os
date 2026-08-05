// Google Sheets sync — Call Reporting lead rows.
//
// The connected sheet holds one row per lead. Only the FIVE mapped columns —
// Date, Created Time, Called <3m, Called <10m, Pipeline name — are ever
// requested from the Sheets API (per-column batchGet ranges) and stored;
// names/phones/emails in other columns never leave Google (data minimisation).
//
// Three paths (fullSync/topUp are per-source now — one org can have several
// connected sheets):
//   fullSync(orgId, sourceId) — paged re-read of the whole tab; rows diffed by
//                      sha256 row_hash so unchanged rows aren't rewritten; rows
//                      gone from the sheet are deleted. Catches in-place edits
//                      (e.g. first-call time filled in later).
//   topUp(orgId, source) — cheap append-only read of rows AFTER
//                      last_synced_row, run on dashboard view (debounced 60s
//                      in-memory, keyed per org+source) so "Today" is
//                      near-live regardless of sheet size.
//   syncAllOrgs()    — nightly worker fan-out over every configured source.
//                      Retries 'failed' sources too (a transient error must
//                      never freeze a source — GHL lesson) and isolates
//                      per-source failures.
//
// Values are requested UNFORMATTED (serial datetimes) and converted to UTC
// using the sheet's own timezone. Row values are never logged — counts only.

import crypto from 'node:crypto';
import { sheetRepository } from '../../repositories/sheet.repository.js';
import { sheetsFetch } from './google-sheets-provider.js';

const PAGE_ROWS = 5000;
const TOPUP_ROWS = 2000;
const UPSERT_CHUNK = 500;
const DEFAULT_TZ = 'Europe/London';
export const MAPPED_FIELDS = ['date', 'created_time', 'called_3m', 'called_10m', 'pipeline_name'];

// A usable mapping has every one of the five fields as a column index. A
// stale/foreign shape (e.g. a surviving v1 row) must read as unconfigured —
// never as colLetter(undefined) emitting a garbage A1 range.
export function isValidMapping(mapping) {
    return !!mapping && MAPPED_FIELDS.every((f) => Number.isInteger(mapping?.[f]));
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

// 0-based column index -> A1 letter (0=A, 25=Z, 26=AA).
export function colLetter(idx) {
    let n = Math.floor(idx);
    let s = '';
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}

function quoteTab(tab) {
    return `'${String(tab).replace(/'/g, "''")}'`;
}

// Offset (ms) of an IANA timezone at a given UTC instant, via Intl.
function tzOffsetMs(tz, utcMs) {
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
    return asUtc - utcMs;
}

// Date cell -> wall-clock ms at midnight. Serial numbers floor to whole days
// (25569 = 1970-01-01); text accepts ISO yyyy-mm-dd, else MM/DD/YYYY — the
// sheet's stated format, deliberately NOT British dd/mm.
export function parseDateWallMs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        return (Math.floor(v) - 25569) * 86400000;
    }
    const s = String(v ?? '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const mo = +m[1];
        const d = +m[2];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        const ms = Date.UTC(+m[3], mo - 1, d);
        const dt = new Date(ms);
        // Reject impossible dates (e.g. 02/31) instead of letting UTC roll over.
        if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
        return ms;
    }
    return null;
}

// Time cell -> ms into the day. Serial values use their fractional part (works
// for bare times and full datetimes alike); text accepts hh:mm[:ss] + am/pm.
// Blank or unparsable -> midnight — a missing time must not lose the lead.
export function parseTimeOfDayMs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.round((v - Math.floor(v)) * 86400000);
    }
    const m = String(v ?? '').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return 0;
    let h = +m[1];
    if (m[4] === 'pm' && h < 12) h += 12;
    if (m[4] === 'am' && h === 12) h = 0;
    return ((h * 60 + +m[2]) * 60 + +(m[3] ?? 0)) * 1000;
}

// Date + time cells -> ISO UTC (wall time in the sheet's timezone).
export function combineDateTime(dateVal, timeVal, tz = DEFAULT_TZ) {
    const dayMs = parseDateWallMs(dateVal);
    if (dayMs == null) return null;
    const wallMs = dayMs + parseTimeOfDayMs(timeVal);
    return new Date(wallMs - tzOffsetMs(tz, wallMs)).toISOString();
}

// Yes/No call columns. Checkbox TRUE or yes/y/true/1 text (any case) -> true;
// everything else — including blank — false.
export function parseYesNo(v) {
    if (v === true) return true;
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

// Deterministic content hash of the four stored values (change detection).
export function hashRow(fields) {
    return crypto.createHash('sha256')
        .update(JSON.stringify([
            fields.created_at ?? null,
            fields.called_3m ?? false,
            fields.called_10m ?? false,
            fields.pipeline_name ?? null,
        ]))
        .digest('hex');
}

// Turn one page of per-column value arrays into parsed row objects.
// columns = { date: [], created_time: [], ... } (arrays of cell values),
// startRow = 1-based sheet row of index 0. Returns { rows, skipped, lastDataRow }.
export function parsePage(columns, startRow, tz = DEFAULT_TZ) {
    const len = Math.max(...MAPPED_FIELDS.map((f) => columns[f]?.length ?? 0), 0);
    const rows = [];
    let skipped = 0;
    let lastDataRow = 0;
    for (let i = 0; i < len; i += 1) {
        const raw = Object.fromEntries(MAPPED_FIELDS.map((f) => [f, columns[f]?.[i]]));
        const empty = MAPPED_FIELDS.every((f) => raw[f] == null || String(raw[f]).trim() === '');
        if (empty) continue;
        lastDataRow = startRow + i;
        const created = combineDateTime(raw.date, raw.created_time, tz);
        if (!created) { skipped += 1; continue; }
        const fields = {
            created_at: created,
            called_3m: parseYesNo(raw.called_3m),
            called_10m: parseYesNo(raw.called_10m),
            pipeline_name: String(raw.pipeline_name ?? '').trim() || null,
        };
        rows.push({ sheet_row_index: startRow + i, ...fields, row_hash: hashRow(fields) });
    }
    return { rows, skipped, lastDataRow };
}

// ---------------------------------------------------------------------------
// Sheets API reads
// ---------------------------------------------------------------------------

// Spreadsheet metadata: title, timezone, tab list. Also the reachability check
// used before a source is persisted.
export async function getMeta(orgId, spreadsheetId) {
    const body = await sheetsFetch(orgId, `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`, {
        fields: 'properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });
    return {
        title: body?.properties?.title ?? null,
        timezone: body?.properties?.timeZone ?? null,
        tabs: (body?.sheets ?? []).map((s) => ({
            title: s?.properties?.title,
            rowCount: s?.properties?.gridProperties?.rowCount ?? 0,
            columnCount: s?.properties?.gridProperties?.columnCount ?? 0,
        })),
    };
}

// First rows of a tab, FORMATTED, for the one-time column-mapping UI. Shown to
// the owner only and never stored.
export async function getPreview(orgId, spreadsheetId, tabName, maxRows = 8) {
    const range = `${quoteTab(tabName)}!A1:Z${maxRows}`;
    const body = await sheetsFetch(orgId, `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
        valueRenderOption: 'FORMATTED_VALUE',
    });
    return body?.values ?? [];
}

// One page of the five mapped columns, UNFORMATTED. Returns per-field arrays.
async function fetchMappedPage(orgId, source, startRow, endRow) {
    const tab = quoteTab(source.tab_name);
    const mapping = source.column_mapping;
    const ranges = MAPPED_FIELDS.map((f) => {
        const col = colLetter(mapping[f]);
        return `${tab}!${col}${startRow}:${col}${endRow}`;
    });
    const body = await sheetsFetch(orgId, `/v4/spreadsheets/${encodeURIComponent(source.spreadsheet_id)}/values:batchGet`, {
        ranges,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
        majorDimension: 'COLUMNS',
    });
    const valueRanges = body?.valueRanges ?? [];
    const columns = {};
    MAPPED_FIELDS.forEach((f, i) => {
        // majorDimension=COLUMNS => values = [ [cell, cell, ...] ] (one column).
        columns[f] = valueRanges[i]?.values?.[0] ?? [];
    });
    return columns;
}

// ---------------------------------------------------------------------------
// Sync paths
// ---------------------------------------------------------------------------

export async function fullSync(orgId, sourceId) {
    const source = await sheetRepository.getSourceById(orgId, sourceId);
    if (!source) return { skipped: 'no_source' };
    if (!isValidMapping(source.column_mapping) || !source.tab_name) return { skipped: 'not_configured' };
    const tz = source.sheet_timezone || DEFAULT_TZ;
    try {
        const meta = await getMeta(orgId, source.spreadsheet_id);
        if (!meta.tabs.some((t) => t.title === source.tab_name)) {
            throw new Error(`Tab "${source.tab_name}" no longer exists in the sheet`);
        }
        const existing = await sheetRepository.leadHashesBySource(orgId, source.id);

        let start = source.header_row + 1;
        let lastDataRow = source.header_row;
        let skipped = 0;
        let upserted = 0;
        let seen = 0;
        for (;;) {
            const end = start + PAGE_ROWS - 1;
            const columns = await fetchMappedPage(orgId, source, start, end);
            const page = parsePage(columns, start, tz);
            skipped += page.skipped;
            if (page.lastDataRow > lastDataRow) lastDataRow = page.lastDataRow;
            seen += page.rows.length;
            const changed = page.rows.filter((r) => existing.get(r.sheet_row_index) !== r.row_hash);
            for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
                await sheetRepository.upsertLeads(orgId, source.id, changed.slice(i, i + UPSERT_CHUNK));
            }
            upserted += changed.length;
            const pageLen = Math.max(...MAPPED_FIELDS.map((f) => columns[f]?.length ?? 0), 0);
            if (pageLen < PAGE_ROWS) break;   // trailing page — no more data
            start = end + 1;
        }

        // Rows that vanished from the sheet (tail truncation) — remove.
        const deleted = await sheetRepository.deleteLeadsBeyondRow(orgId, source.id, lastDataRow);
        await sheetRepository.updateSource(orgId, source.id, {
            title: meta.title ?? source.title,
            sheet_timezone: meta.timezone ?? source.sheet_timezone,
            status: 'active',
            last_error: null,
            last_synced_row: lastDataRow,
            row_count: seen,
            skipped_rows: skipped,
            last_synced_at: new Date().toISOString(),
        });
        console.log(`[sheets-sync] org=${orgId} source=${source.id} full sync ok: rows=${seen} changed=${upserted} deleted=${deleted} skipped=${skipped}`);
        return { ok: true, rows: seen, changed: upserted, deleted, skipped };
    } catch (err) {
        await sheetRepository.updateSource(orgId, source.id, {
            status: 'failed',
            last_error: String(err.message ?? err).slice(0, 500),
        }).catch(() => {});
        throw err;
    }
}

// In-memory debounce for the on-view top-up (per process, per org+source).
const lastTopUp = new Map();

// Append-only read of rows after last_synced_row for ONE source. Cheap
// regardless of sheet size; failures degrade gracefully (cached data renders).
export async function topUp(orgId, source) {
    if (!isValidMapping(source?.column_mapping) || !source.tab_name || source.status === 'pending') {
        return { skipped: 'not_configured' };
    }
    const key = `${orgId}:${source.id}`;
    const last = lastTopUp.get(key) ?? 0;
    if (Date.now() - last < 60_000) return { skipped: 'debounced' };
    lastTopUp.set(key, Date.now());
    try {
        const tz = source.sheet_timezone || DEFAULT_TZ;
        const start = Math.max(source.last_synced_row, source.header_row) + 1;
        const columns = await fetchMappedPage(orgId, source, start, start + TOPUP_ROWS - 1);
        const page = parsePage(columns, start, tz);
        if (page.rows.length === 0 && page.skipped === 0) return { ok: true, added: 0 };
        for (let i = 0; i < page.rows.length; i += UPSERT_CHUNK) {
            await sheetRepository.upsertLeads(orgId, source.id, page.rows.slice(i, i + UPSERT_CHUNK));
        }
        const lastDataRow = Math.max(page.lastDataRow, source.last_synced_row);
        await sheetRepository.updateSource(orgId, source.id, {
            last_synced_row: lastDataRow,
            row_count: source.row_count + page.rows.length,
            skipped_rows: source.skipped_rows + page.skipped,
            last_synced_at: new Date().toISOString(),
        });
        return { ok: true, added: page.rows.length };
    } catch (err) {
        // Never block the dashboard on a top-up failure — log count-free.
        console.error(`[sheets-sync] org=${orgId} source=${source.id} top-up failed: ${err.message}`);
        return { ok: false, error: err.message };
    }
}

// Dashboard freshness: top-up every configured source. Never throws.
export async function topUpAll(orgId) {
    const sources = await sheetRepository.listSources(orgId);
    let ok = true;
    for (const s of sources) {
        const r = await topUp(orgId, s);
        if (r?.ok === false) ok = false;
    }
    return { ok };
}

// Nightly worker fan-out. Includes 'failed' sources (self-heal) and isolates
// per-source errors so one bad sheet never freezes the rest.
export async function syncAllOrgs() {
    const sources = await sheetRepository.listConfiguredSources();
    const results = [];
    for (const s of sources) {
        try {
            const r = await fullSync(s.organisation_id, s.id);
            results.push({ orgId: s.organisation_id, sourceId: s.id, ...r });
        } catch (err) {
            console.error(`[sheets-sync] org=${s.organisation_id} source=${s.id} nightly sync failed: ${err.message}`);
            results.push({ orgId: s.organisation_id, sourceId: s.id, error: err.message });
        }
    }
    return results;
}
