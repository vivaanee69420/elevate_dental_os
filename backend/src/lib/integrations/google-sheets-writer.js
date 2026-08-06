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
    const mapped = (meta.developerMetadata ?? [])
        .find((m) => m.metadataKey === metaKey(practiceId));
    if (mapped) {
        const sheet = (meta.sheets ?? [])
            .find((s) => String(s.properties?.sheetId) === String(mapped.metadataValue));
        if (sheet) return sheet.properties.title;
    }
    // Create the tab + stamp the practice UUID as spreadsheet-level metadata.
    const title = String(practiceName || 'Unassigned').slice(0, 90);
    const created = await addSheetTab(orgId, spreadsheetId, title);
    const props = created.replies?.[0]?.addSheet?.properties;
    const sheetId = props?.sheetId;
    const finalTitle = props?.title ?? title;
    await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests: [{ createDeveloperMetadata: { developerMetadata: {
            metadataKey: metaKey(practiceId), metadataValue: String(sheetId),
            location: { spreadsheet: true }, visibility: 'DOCUMENT',
        } } }] },
    });
    await appendRows(orgId, spreadsheetId, finalTitle, [HEADER]);
    return finalTitle;
}

export async function appendRows(orgId, spreadsheetId, tabTitle, rows) {
    if (!rows.length) return { appended: 0 };
    const range = encodeURIComponent(`${tabTitle}!A1`);
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
    const range = encodeURIComponent(`${tabTitle}!G2:G`);
    const res = await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    return new Set((res.values ?? []).map((r) => String(r[0] ?? '')).filter(Boolean));
}
