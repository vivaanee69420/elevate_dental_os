// Tab management + idempotent append for the conversion export. Tab identity
// is a developer-metadata key (practice UUID, or the singleton open-days tab)
// — NOT the display name — so renaming a tab/practice never forks a new one.
import { writerFetch } from './google-sheets-writer-provider.js';

export const HEADER = ['Lead Incoming Date', 'Name', 'Email', 'Phone',
    'Source (Pipeline)', 'Appointment Date', 'Treatment',
    'Status', 'Invoiced', 'Collected', 'Export ID'];
// Open-day conversions from every practice collect on ONE tab, so it carries
// an extra Practice column. Export ID stays last (hidden).
export const OPEN_DAY_HEADER = ['Lead Incoming Date', 'Name', 'Email', 'Phone',
    'Source (Pipeline)', 'Appointment Date', 'Treatment', 'Practice',
    'Status', 'Invoiced', 'Collected', 'Export ID'];

export function formatLondonDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(iso));
}

// Date cells are written as Sheets SERIAL numbers (days since 1899-12-30) so
// the tab can be genuinely sorted by date — text "06/08/2026" sorts before
// "28/07/2026" alphabetically. Display stays dd/mm/yyyy via the column number
// format applied at tab creation/self-heal. Timezone: the London calendar day.
export function londonDateSerial(iso) {
    if (!iso) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(new Date(iso));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000 + 25569;
}

// Lead Incoming Date (A) and Appointment Date (F) — same positions on both
// tab layouts.
const DATE_COLUMN_INDEXES = [0, 5];
const dateFormatRequests = (sheetId) => DATE_COLUMN_INDEXES.map((col) => ({
    repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
        fields: 'userEnteredFormat.numberFormat',
    },
}));

const metaKey = (practiceId) => `practice:${practiceId}`;
const OPEN_DAY_KEY = 'openday:tab';

// A1 range tab titles must be single-quoted (Sheets requires it for titles
// with spaces, and it disambiguates titles containing special characters);
// an internal apostrophe is escaped by doubling it, per the A1 notation spec.
const quoteTab = (title) => `'${String(title).replace(/'/g, "''")}'`;

// 1-based column number -> A1 letter (only needed up to Z here).
const colLetter = (n) => String.fromCharCode(64 + n);

async function addSheetTab(orgId, spreadsheetId, title) {
    try {
        return await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            body: { requests: [{ addSheet: { properties: { title } } }] },
        });
    } catch (err) {
        // Two practices sharing a display name would otherwise 400 on the
        // duplicate title — suffix once and retry rather than fail the export.
        if (err?.status === 400) {
            return writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
                method: 'POST',
                body: { requests: [{ addSheet: { properties: { title: `${title} (2)` } } }] },
            });
        }
        throw err;
    }
}

// The Export ID column is always the header's LAST column — hidden because it
// is bookkeeping (the idempotency key that stops a crash between append and
// mark-exported from ever double-writing a conversion), not report content.
const hideExportIdRequest = (sheetId, header) => ({ updateDimensionProperties: {
    range: { sheetId, dimension: 'COLUMNS', startIndex: header.length - 1, endIndex: header.length },
    properties: { hiddenByUser: true },
    fields: 'hiddenByUser',
} });

// Repair a mapped tab whose header row is missing (owner cleared the tab's
// contents, or the tab predates the current column set): insert a fresh row 1,
// write the header into it, and (idempotently) re-hide the Export ID column.
async function ensureHeader(orgId, spreadsheetId, sheetId, title, header) {
    const checkRange = encodeURIComponent(`${quoteTab(title)}!A1:${colLetter(header.length)}1`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${checkRange}`);
    if (res.values?.[0]?.[0] === header[0]) return;
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [
            { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 } } },
            hideExportIdRequest(sheetId, header),
            ...dateFormatRequests(sheetId),
        ] },
    });
    const writeRange = encodeURIComponent(`${quoteTab(title)}!A1`);
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${writeRange}`, {
        method: 'PUT',
        params: { valueInputOption: 'RAW' },
        body: { values: [header] },
    });
}

// Generic metadata-keyed tab resolver/creator shared by practice tabs and the
// singleton Open Days tab.
async function ensureTab(orgId, spreadsheetId, key, desiredTitle, header) {
    const meta = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'sheets(properties(sheetId,title)),developerMetadata(metadataKey,metadataValue)' },
    });
    // Metadata is append-only — a stale entry (its mapped tab was deleted)
    // can sit ahead of a still-valid one. Consider ALL entries for this key
    // and use whichever one still resolves to a live sheetId.
    const candidates = (meta.developerMetadata ?? []).filter((m) => m.metadataKey === key);
    for (const mapped of candidates) {
        const sheet = (meta.sheets ?? [])
            .find((s) => String(s.properties?.sheetId) === String(mapped.metadataValue));
        if (sheet) {
            // Self-heal: an owner clearing the tab's contents (rather than
            // deleting it) leaves a live mapping with no header row.
            await ensureHeader(orgId, spreadsheetId, sheet.properties.sheetId, sheet.properties.title, header);
            return sheet.properties.title;
        }
    }
    // No live mapping. Create the tab + stamp the identity key as
    // spreadsheet-level metadata, clearing out any stale entries for this
    // key in the same batchUpdate so they never re-shadow a future lookup.
    const created = await addSheetTab(orgId, spreadsheetId, desiredTitle);
    const props = created.replies?.[0]?.addSheet?.properties;
    const sheetId = props?.sheetId;
    const finalTitle = props?.title ?? desiredTitle;
    const requests = [];
    if (candidates.length) {
        requests.push({ deleteDeveloperMetadata: {
            dataFilter: { developerMetadataLookup: { metadataKey: key } },
        } });
    }
    requests.push({ createDeveloperMetadata: { developerMetadata: {
        metadataKey: key, metadataValue: String(sheetId),
        location: { spreadsheet: true }, visibility: 'DOCUMENT',
    } } });
    requests.push(hideExportIdRequest(sheetId, header));
    requests.push(...dateFormatRequests(sheetId));
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests },
    });
    await appendRows(orgId, spreadsheetId, finalTitle, [header]);
    return finalTitle;
}

export async function ensurePracticeTab(orgId, spreadsheetId, practiceId, practiceName) {
    const title = String(practiceName || 'Unassigned').slice(0, 90);
    return ensureTab(orgId, spreadsheetId, metaKey(practiceId), title, HEADER);
}

// The org-wide Open Days tab (open-day pipeline conversions from every
// practice, with a Practice column).
export async function ensureOpenDayTab(orgId, spreadsheetId) {
    return ensureTab(orgId, spreadsheetId, OPEN_DAY_KEY, 'Open Days', OPEN_DAY_HEADER);
}

export async function appendRows(orgId, spreadsheetId, tabTitle, rows) {
    if (!rows.length) return { appended: 0 };
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!A1`);
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}:append`, {
        method: 'POST',
        params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        body: { values: rows },
    });
    return { appended: rows.length };
}

// Export ID = queue row uuid, in the header's LAST column (position varies by
// tab generation as columns were added). Read G:L and union every non-empty
// cell — only uuid equality is ever tested against the set, so neighbouring
// display values are harmless. Read on retry so a crash between append and
// mark-exported can never double-write a conversion.
export async function readExportIds(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!G2:L`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    const ids = new Set();
    for (const row of res.values ?? []) {
        for (const cell of row) if (cell) ids.add(String(cell));
    }
    return ids;
}

// --- Refresh support (nightly Status/Invoiced/Collected updates) -----------

// Every tab this export owns (developer-metadata mapped), resolved to its
// CURRENT title. Never creates anything.
export async function listMappedTabs(orgId, spreadsheetId) {
    const meta = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'sheets(properties(sheetId,title)),developerMetadata(metadataKey,metadataValue)' },
    });
    const out = [];
    const seen = new Set();
    for (const m of meta.developerMetadata ?? []) {
        if (!m.metadataKey?.startsWith('practice:') && m.metadataKey !== OPEN_DAY_KEY) continue;
        const sheet = (meta.sheets ?? [])
            .find((s) => String(s.properties?.sheetId) === String(m.metadataValue));
        if (sheet && !seen.has(sheet.properties.sheetId)) {
            seen.add(sheet.properties.sheetId);
            out.push({ key: m.metadataKey, title: sheet.properties.title });
        }
    }
    return out;
}

// Full grid of a tab (A:L covers every layout generation), values-only.
export async function readTabGrid(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!A1:L`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    return res.values ?? [];
}

// In-place cell updates: data = [{ range: "'Tab'!H5:J5", values: [[...]] }].
// Ranges must already be A1-quoted via rangeFor / quoteTab.
export async function batchUpdateCells(orgId, spreadsheetId, data) {
    if (!data.length) return { updated: 0 };
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data },
    });
    return { updated: data.length };
}

// A1 range for a contiguous cell run on one row: cols are 1-based indexes.
export function rangeFor(tabTitle, rowNumber, colStart, colEnd) {
    return `${quoteTab(tabTitle)}!${colLetter(colStart)}${rowNumber}:${colLetter(colEnd)}${rowNumber}`;
}

// Sort every mapped tab's data rows (row 2+) by Lead Incoming Date ascending
// (oldest first). Sorting rearranges whole rows, so the hidden Export IDs
// travel with their rows — dedup and refresh both re-read the grid each run
// and are unaffected. One batchUpdate for all tabs.
export async function sortMappedTabsByLeadDate(orgId, spreadsheetId) {
    const meta = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'sheets(properties(sheetId,title)),developerMetadata(metadataKey,metadataValue)' },
    });
    const mappedIds = new Set((meta.developerMetadata ?? [])
        .filter((m) => m.metadataKey?.startsWith('practice:') || m.metadataKey === OPEN_DAY_KEY)
        .map((m) => String(m.metadataValue)));
    const requests = (meta.sheets ?? [])
        .filter((s) => mappedIds.has(String(s.properties?.sheetId)))
        .map((s) => ({ sortRange: {
            range: { sheetId: s.properties.sheetId, startRowIndex: 1 },
            sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
        } }));
    if (!requests.length) return { sorted: 0 };
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests },
    });
    return { sorted: requests.length };
}
