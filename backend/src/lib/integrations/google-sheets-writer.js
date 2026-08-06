// Tab management + idempotent append for the conversion export. Tab identity
// is a developer-metadata key (practice UUID, or the singleton open-days tab)
// — NOT the display name — so renaming a tab/practice never forks a new one.
import { writerFetch } from './google-sheets-writer-provider.js';

export const HEADER = ['Lead Incoming Date', 'Name', 'Email', 'Phone',
    'Source (Pipeline)', 'Appointment Date', 'Treatment', 'Export ID'];
// Open-day conversions from every practice collect on ONE tab, so it carries
// an extra Practice column. Export ID stays last (hidden).
export const OPEN_DAY_HEADER = ['Lead Incoming Date', 'Name', 'Email', 'Phone',
    'Source (Pipeline)', 'Appointment Date', 'Treatment', 'Practice', 'Export ID'];

export function formatLondonDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(iso));
}

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

// Export ID = queue row uuid, in the header's LAST column: I on the Open Days
// tab, H on practice tabs, G on tabs created before the Treatment column
// existed. Read G:I and union every non-empty cell — only uuid equality is
// ever tested against the set, so neighbouring display values are harmless.
// Read on retry so a crash between append and mark-exported can never
// double-write a conversion.
export async function readExportIds(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!G2:I`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    const ids = new Set();
    for (const row of res.values ?? []) {
        for (const cell of row) if (cell) ids.add(String(cell));
    }
    return ids;
}
