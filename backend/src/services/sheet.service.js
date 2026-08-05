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
import { getMeta, getPreview, fullSync, topUpAll } from "../lib/integrations/google-sheets-sync.js";

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
        id: source.id,
        practice_label: source.practice_label,
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
        mapped: !!source.column_mapping,
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
    // Panel state: connection + every connected sheet in one call.
    async status(orgId) {
        const [integration, sources] = await Promise.all([
            integrationRepository.getByProvider(orgId, PROVIDER_ID),
            sheetRepository.listSources(orgId),
        ]);
        const connected = !!integration && integration.status !== 'revoked' && !!integration.secrets;
        return {
            connected,
            connectionStatus: integration?.status ?? null,
            connectionError: integration?.last_error ?? null,
            sources: sources.map(safeSource),
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

    // Register one practice's sheet. Validates reachability with a metadata
    // read BEFORE persisting and returns the tab list for the mapping step.
    async addSource(orgId, { url, practice_label }) {
        await requireConnected(orgId);
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw new AppError('That does not look like a Google Sheets URL', 400);
        let meta;
        try {
            meta = await getMeta(orgId, spreadsheetId);
        } catch (err) {
            throw new AppError(`Could not open that sheet: ${err.message}`, 400);
        }
        const row = await sheetRepository.createSource(orgId, {
            spreadsheet_id: spreadsheetId,
            spreadsheet_url: url.startsWith('http') ? url : null,
            title: meta.title,
            sheet_timezone: meta.timezone,
            practice_label,
        });
        return { ok: true, id: row.id, title: meta.title, tabs: meta.tabs.map((t) => t.title) };
    },

    // First rows of a tab for the mapping UI. Ephemeral — never stored.
    async preview(orgId, { sourceId, tab }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        const rows = await getPreview(orgId, source.spreadsheet_id, tab);
        return { tab, rows };
    },

    // Save the one-time column mapping for one sheet, then kick its full sync
    // (fire-and-forget — the panel polls status; last_error lands on the source).
    async saveMapping(orgId, { sourceId, tab_name, header_row, columns }) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        await sheetRepository.updateSource(orgId, sourceId, {
            tab_name,
            header_row,
            column_mapping: columns,
            status: 'pending',
            last_error: null,
            last_synced_row: 0,
        });
        fullSync(orgId, sourceId).catch((err) => {
            console.error(`[sheets] org=${orgId} source=${sourceId} post-mapping sync failed: ${err.message}`);
        });
        return { ok: true, syncStarted: true };
    },

    // Manual "Refresh now" for one sheet — full re-sync, fire-and-forget.
    async syncNow(orgId, sourceId) {
        await requireConnected(orgId);
        const source = await sheetRepository.getSourceById(orgId, sourceId);
        if (!source) throw new AppError('Sheet not found', 404);
        if (!source.column_mapping) throw new AppError('Finish the column mapping first', 409);
        fullSync(orgId, sourceId).catch((err) => {
            console.error(`[sheets] org=${orgId} source=${sourceId} manual sync failed: ${err.message}`);
        });
        return { started: true };
    },

    // Remove ONE practice's sheet: its synced rows, then the source row.
    async removeSource(orgId, sourceId) {
        await sheetRepository.deleteLeadsBySource(orgId, sourceId);
        await sheetRepository.deleteSource(orgId, sourceId);
        return { ok: true };
    },

    // Disconnect = clean exit: purge every synced row and every source, then
    // revoke the integration (markRevoked nulls the secrets).
    async disconnect(orgId) {
        await sheetRepository.deleteAllLeads(orgId);
        await sheetRepository.deleteAllSources(orgId);
        await integrationRepository.markRevoked(orgId, PROVIDER_ID);
        return { ok: true };
    },

    // The ten cards. Runs the cheap append-only top-up on every configured
    // sheet first (debounced; failure degrades to cached data) then ONE
    // aggregate RPC round trip. sourceId null = all practices.
    async dashboard(orgId, { date, sourceId }) {
        const sources = await sheetRepository.listSources(orgId);
        if (!sources.some((s) => s.column_mapping)) {
            return { configured: false };
        }
        const freshness = await topUpAll(orgId);
        const day = date ?? todayLondon();
        const row = await sheetRepository.dashboard(orgId, {
            date: day,
            sourceId: sourceId ?? null,
            tz: LONDON_TZ,
        });
        const total = Number(row?.total ?? 0);
        const called3m = Number(row?.called_3m ?? 0);
        return {
            configured: true,
            date: day,
            sourceId: sourceId ?? null,
            totalLeads: total,
            calledWithin3m: called3m,
            calledWithin10m: Number(row?.called_10m ?? 0),
            efficiencyPct: total > 0 ? Math.round((called3m / total) * 1000) / 10 : 0,
            leadsInPipeline: Number(row?.in_pipeline ?? 0),
            notCalled: Number(row?.not_called ?? 0),
            officeTimeLeads: Number(row?.office_time ?? 0),
            outsideOfficeTime: Number(row?.outside_office ?? 0),
            facebookLeads: Number(row?.facebook ?? 0),
            googleLeads: Number(row?.google ?? 0),
            sources: sources.map((s) => ({
                id: s.id,
                practice_label: s.practice_label,
                status: s.status,
                last_synced_at: s.last_synced_at,
                mapped: !!s.column_mapping,
            })),
            syncFailed: sources.some((s) => s.status === 'failed'),
            lastSyncedAt: sources.map((s) => s.last_synced_at).filter(Boolean).sort().at(-1) ?? null,
            topUpOk: freshness?.ok !== false,
        };
    },
};
