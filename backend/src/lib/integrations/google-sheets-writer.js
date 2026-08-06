// Tab management + idempotent append for the conversion export. Tab identity
// is the practice UUID in spreadsheet developer metadata — NOT the display
// name — so renaming a practice in the app never forks a new tab.
import { writerFetch } from './google-sheets-writer-provider.js';

export const HEADER = ['Name', 'Email', 'Phone', 'Source (Pipeline)',
    'Appointment Date', 'Lead Incoming Date', 'Export ID'];

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
        if (sheet) return sheet.properties.title;
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

// Column G = Export ID (queue row uuid). Read on retry so a crash between
// append and mark-exported can never double-write a conversion.
export async function readExportIds(orgId, spreadsheetId, tabTitle) {
    const range = encodeURIComponent(`${quoteTab(tabTitle)}!G2:G`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    return new Set((res.values ?? []).map((r) => String(r[0] ?? '')).filter(Boolean));
}
