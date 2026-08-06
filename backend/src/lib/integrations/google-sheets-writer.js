// Tab management + idempotent append for the conversion export. Tab identity
// is the practice UUID in spreadsheet developer metadata — NOT the display
// name — so renaming a practice in the app never forks a new tab.
import { writerFetch } from './google-sheets-writer-provider.js';

export const HEADER = ['Lead Incoming Date', 'Name', 'Email', 'Phone',
    'Source (Pipeline)', 'Appointment Date', 'Treatment', 'Export ID'];

export function formatLondonDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(iso));
}

const metaKey = (practiceId) => `practice:${practiceId}`;

// A1 range tab titles must be single-quoted (Sheets requires it for titles
// with spaces, and it disambiguates titles containing special characters);
// an internal apostrophe is escaped by doubling it, per the A1 notation spec.
const quoteTab = (title) => `'${String(title).replace(/'/g, "''")}'`;

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

// Repair a mapped tab whose header row is missing (owner cleared the tab's
// contents, or the tab predates the current column set): insert a fresh row 1,
// write HEADER into it, and (idempotently) hide the Export ID column.
async function ensureHeader(orgId, spreadsheetId, sheetId, title) {
    const checkRange = encodeURIComponent(`${quoteTab(title)}!A1:H1`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${checkRange}`);
    if (res.values?.[0]?.[0] === HEADER[0]) return;
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [
            { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 } } },
            { updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 },
                properties: { hiddenByUser: true },
                fields: 'hiddenByUser',
            } },
        ] },
    });
    const writeRange = encodeURIComponent(`${quoteTab(title)}!A1`);
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${writeRange}`, {
        method: 'PUT',
        params: { valueInputOption: 'RAW' },
        body: { values: [HEADER] },
    });
}

export async function ensurePracticeTab(orgId, spreadsheetId, practiceId, practiceName) {
    const meta = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'sheets(properties(sheetId,title)),developerMetadata(metadataKey,metadataValue)' },
    });
    // Metadata is append-only — a stale entry (its mapped tab was deleted)
    // can sit ahead of a still-valid one. Consider ALL entries for this key
    // and use whichever one still resolves to a live sheetId.
    const key = metaKey(practiceId);
    const candidates = (meta.developerMetadata ?? []).filter((m) => m.metadataKey === key);
    for (const mapped of candidates) {
        const sheet = (meta.sheets ?? [])
            .find((s) => String(s.properties?.sheetId) === String(mapped.metadataValue));
        if (sheet) {
            // Self-heal: an owner clearing the tab's contents (rather than
            // deleting it) leaves a live mapping with no header row — repair it
            // (and re-hide the Export ID column) before any append.
            await ensureHeader(orgId, spreadsheetId, sheet.properties.sheetId, sheet.properties.title);
            return sheet.properties.title;
        }
    }
    // No live mapping. Create the tab + stamp the practice UUID as
    // spreadsheet-level metadata, clearing out any stale entries for this
    // key in the same batchUpdate so they never re-shadow a future lookup.
    const title = String(practiceName || 'Unassigned').slice(0, 90);
    const created = await addSheetTab(orgId, spreadsheetId, title);
    const props = created.replies?.[0]?.addSheet?.properties;
    const sheetId = props?.sheetId;
    const finalTitle = props?.title ?? title;
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
    // Export ID (column H) is bookkeeping, not report content — hide it so the
    // owner sees only the display columns. It must still EXIST: it is the
    // idempotency key that stops a crash between append and mark-exported from
    // ever double-writing a conversion.
    requests.push({ updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
    } });
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests },
    });
    await appendRows(orgId, spreadsheetId, finalTitle, [HEADER]);
    return finalTitle;
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

// Export ID = queue row uuid, column H (column G on tabs created before the
// Treatment column existed — read both and union, so old tabs keep deduping).
// Read on retry so a crash between append and mark-exported can never
// double-write a conversion.
export async function readExportIds(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!G2:H`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    const ids = new Set();
    for (const row of res.values ?? []) {
        for (const cell of row) if (cell) ids.add(String(cell));
    }
    return ids;
}
