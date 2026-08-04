// ============================================================================
// Sheet service — Call Reporting (Google Sheets) business logic.
// Connection state lives on the integrations row (encrypted tokens, never
// exposed); the source/mapping/practice-map live in sheet_* tables. Row values
// are never logged and never leave this domain (excluded from AI context).
// ============================================================================
import { AppError } from "../middleware/errors.js";
import { sheetRepository } from "../repositories/sheet.repository.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { parseSpreadsheetId, getAccessToken, PROVIDER_ID } from "../lib/integrations/google-sheets-provider.js";
import { getMeta, getPreview, fullSync, topUp } from "../lib/integrations/google-sheets-sync.js";

const LONDON_TZ = 'Europe/London';

// Today's date (YYYY-MM-DD) in London — the dashboard's default day.
function todayLondon() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON_TZ }).format(new Date());
}

// Public source shape: everything the panel needs, nothing sensitive (there
// are no secrets on sheet_sources, but keep the surface explicit anyway).
function safeSource(source) {
    if (!source) return null;
    return {
        spreadsheet_id: source.spreadsheet_id,
        spreadsheet_url: source.spreadsheet_url,
        title: source.title,
        tab_name: source.tab_name,
        sheet_timezone: source.sheet_timezone,
        column_mapping: source.column_mapping,
        header_row: source.header_row,
        row_count: source.row_count,
        skipped_rows: source.skipped_rows,
        status: source.status,
        last_error: source.last_error,
        last_synced_at: source.last_synced_at,
    };
}

async function requireConnected(orgId) {
    const integration = await integrationRepository.getByProvider(orgId, PROVIDER_ID);
    if (!integration || integration.status === 'revoked' || !integration.secrets) {
        throw new AppError('Google Sheets is not connected', 409);
    }
    return integration;
}

export const sheetService = {
    // Panel state: connection + source + mapping in one call.
    async status(orgId) {
        const [integration, source] = await Promise.all([
            integrationRepository.getByProvider(orgId, PROVIDER_ID),
            sheetRepository.getSource(orgId),
        ]);
        const connected = !!integration && integration.status !== 'revoked' && !!integration.secrets;
        return {
            connected,
            connectionStatus: integration?.status ?? null,
            connectionError: integration?.last_error ?? null,
            source: safeSource(source),
            mapped: !!source?.column_mapping,
        };
    },

    // Google Picker bootstrap for the browse-and-pick flow. Owner-only: the
    // short-lived OAuth access token is handed to the OWNER's browser so
    // Google's picker can render their own Drive — it is their own account's
    // token, scoped read-only (sheets + picked-files). Disabled until the
    // operator sets GOOGLE_PICKER_API_KEY (a browser key for the Picker API).
    async pickerConfig(orgId) {
        const apiKey = (process.env.GOOGLE_PICKER_API_KEY || '').trim();
        if (!apiKey) return { enabled: false };
        await requireConnected(orgId);
        const accessToken = await getAccessToken(orgId);
        return {
            enabled: true,
            apiKey,
            // The Google Cloud project NUMBER — required by the picker for
            // drive.file grants to attach to this app.
            appId: (process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '').trim() || null,
            accessToken,
        };
    },

    // Register the sheet by pasted URL. Validates reachability with a metadata
    // read BEFORE persisting (GHL PIT-check pattern) and returns the tab list
    // for the mapping step.
    async addSource(orgId, { url }) {
        await requireConnected(orgId);
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw new AppError('That does not look like a Google Sheets URL', 400);
        let meta;
        try {
            meta = await getMeta(orgId, spreadsheetId);
        } catch (err) {
            throw new AppError(`Could not open that sheet: ${err.message}`, 400);
        }
        await sheetRepository.createSource(orgId, {
            spreadsheet_id: spreadsheetId,
            spreadsheet_url: url.startsWith('http') ? url : null,
            title: meta.title,
            sheet_timezone: meta.timezone,
        });
        return { ok: true, title: meta.title, tabs: meta.tabs.map((t) => t.title) };
    },

    // First rows of a tab for the mapping UI. Ephemeral — never stored.
    async preview(orgId, { tab }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSource(orgId);
        if (!source) throw new AppError('Add the sheet URL first', 409);
        const rows = await getPreview(orgId, source.spreadsheet_id, tab);
        return { tab, rows };
    },

    // Save the one-time column mapping, then kick a full sync (fire-and-forget
    // — the panel polls status for progress; last_error lands on the source).
    async saveMapping(orgId, { tab_name, header_row, columns }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSource(orgId);
        if (!source) throw new AppError('Add the sheet URL first', 409);
        await sheetRepository.updateSource(orgId, {
            tab_name,
            header_row,
            column_mapping: columns,
            status: 'pending',
            last_error: null,
            last_synced_row: 0,
        });
        fullSync(orgId).catch((err) => {
            console.error(`[sheets] org=${orgId} post-mapping sync failed: ${err.message}`);
        });
        return { ok: true, syncStarted: true };
    },

    // Discovered sheet practice values + org practices for the mapping table.
    async listPracticeMap(orgId) {
        const [values, practices, source] = await Promise.all([
            sheetRepository.listPracticeMap(orgId),
            sheetRepository.practiceOptions(orgId),
            sheetRepository.getSource(orgId),
        ]);
        return { configured: !!source?.column_mapping, values, practices };
    },

    // Set/clear one value's practice, then restamp existing rows in place —
    // instant, no re-sync (Emergent pattern).
    async setPracticeMapping(orgId, { sheet_value, practice_id }) {
        await sheetRepository.setPracticeMapping(orgId, sheet_value, practice_id);
        const restamped = await sheetRepository.restampPractices(orgId);
        return { ok: true, restamped };
    },

    // Manual "Refresh now" — full re-sync, fire-and-forget.
    async syncNow(orgId) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSource(orgId);
        if (!source?.column_mapping) throw new AppError('Finish the column mapping first', 409);
        fullSync(orgId).catch((err) => {
            console.error(`[sheets] org=${orgId} manual sync failed: ${err.message}`);
        });
        return { started: true };
    },

    // Disconnect = clean exit: purge every synced row, the practice map and the
    // source, then revoke the integration (markRevoked nulls the secrets).
    async disconnect(orgId) {
        await sheetRepository.deleteAllLeads(orgId);
        await sheetRepository.deletePracticeMap(orgId);
        await sheetRepository.deleteSource(orgId);
        await integrationRepository.markRevoked(orgId, PROVIDER_ID);
        return { ok: true };
    },

    // The eight cards. Runs the cheap append-only top-up first (debounced;
    // failure degrades to cached data) then one aggregate RPC round trip.
    async dashboard(orgId, { date, practiceId }) {
        const source = await sheetRepository.getSource(orgId);
        if (!source?.column_mapping) {
            return { configured: false, sourceStatus: source?.status ?? null };
        }
        const freshness = await topUp(orgId);
        const day = date ?? todayLondon();
        const row = await sheetRepository.dashboard(orgId, {
            date: day,
            practiceId: practiceId ?? null,
            tz: LONDON_TZ,
        });
        const total = Number(row?.total ?? 0);
        const called3m = Number(row?.called_3m ?? 0);
        return {
            configured: true,
            date: day,
            practiceId: practiceId ?? null,
            totalLeads: total,
            calledWithin3m: called3m,
            calledWithin10m: Number(row?.called_10m ?? 0),
            efficiencyPct: total > 0 ? Math.round((called3m / total) * 1000) / 10 : 0,
            leadsInPipeline: Number(row?.in_pipeline ?? 0),
            notCalled: Number(row?.not_called ?? 0),
            facebookLeads: Number(row?.facebook ?? 0),
            googleLeads: Number(row?.google ?? 0),
            unmapped: Number(row?.unmapped ?? 0),
            sourceStatus: source.status,
            lastSyncedAt: source.last_synced_at,
            topUpOk: freshness?.ok !== false,
        };
    },
};
