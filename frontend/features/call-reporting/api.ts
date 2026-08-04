import { api } from '@/lib/api';

// ---- Call Reporting dashboard ----------------------------------------------

export interface CallReportingDashboard {
  configured: boolean;
  date: string;
  practiceId: string | null;
  totalLeads: number;
  calledWithin3m: number;
  calledWithin10m: number;
  efficiencyPct: number;
  leadsInPipeline: number;
  notCalled: number;
  facebookLeads: number;
  googleLeads: number;
  unmapped: number;
  sourceStatus: string | null;
  lastSyncedAt: string | null;
  topUpOk: boolean;
}

const EMPTY: CallReportingDashboard = {
  configured: false,
  date: '',
  practiceId: null,
  totalLeads: 0,
  calledWithin3m: 0,
  calledWithin10m: 0,
  efficiencyPct: 0,
  leadsInPipeline: 0,
  notCalled: 0,
  facebookLeads: 0,
  googleLeads: 0,
  unmapped: 0,
  sourceStatus: null,
  lastSyncedAt: null,
  topUpOk: true,
};

export function fetchCallReportingDashboard(date: string, practiceId?: string): Promise<CallReportingDashboard> {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (practiceId) qs.set('practice_id', practiceId);
  const q = qs.toString();
  return api<CallReportingDashboard>(`/api/call-reporting/dashboard${q ? `?${q}` : ''}`)
    .then((r) => ({ ...EMPTY, ...r }));
}

// ---- Google Sheets connection / setup --------------------------------------

export interface SheetSourceInfo {
  spreadsheet_id: string;
  spreadsheet_url: string | null;
  title: string | null;
  tab_name: string | null;
  sheet_timezone: string | null;
  column_mapping: Record<string, number> | null;
  header_row: number;
  row_count: number;
  skipped_rows: number;
  status: 'pending' | 'active' | 'failed';
  last_error: string | null;
  last_synced_at: string | null;
}

export interface SheetsStatus {
  connected: boolean;
  connectionStatus: string | null;
  connectionError: string | null;
  source: SheetSourceInfo | null;
  mapped: boolean;
}

export function fetchSheetsStatus() {
  return api<SheetsStatus>('/api/integrations/google-sheets/status');
}

export function addSheetSource(url: string) {
  return api<{ ok: boolean; title: string | null; tabs: string[] }>(
    '/api/integrations/google-sheets/source',
    { method: 'POST', body: JSON.stringify({ url }) },
  );
}

export function fetchSheetPreview(tab: string) {
  return api<{ tab: string; rows: string[][] }>(
    `/api/integrations/google-sheets/source/preview?tab=${encodeURIComponent(tab)}`,
  );
}

export interface SheetMappingInput {
  tab_name: string;
  header_row: number;
  columns: {
    practice: number;
    created_at: number;
    first_call_at: number;
    source: number;
    pipeline_status: number;
  };
}

export function saveSheetMapping(mapping: SheetMappingInput) {
  return api<{ ok: boolean; syncStarted: boolean }>(
    '/api/integrations/google-sheets/source/mapping',
    { method: 'PUT', body: JSON.stringify(mapping) },
  );
}

export interface SheetPracticeMapEntry {
  sheet_value: string;
  practice_id: string | null;
  practice_name: string | null;
}

export function fetchSheetPracticeMap() {
  return api<{ configured: boolean; values: SheetPracticeMapEntry[]; practices: { id: string; name: string }[] }>(
    '/api/integrations/google-sheets/practice-map',
  );
}

export function setSheetPracticeMapping(sheetValue: string, practiceId: string | null) {
  return api<{ ok: boolean; restamped: number }>(
    '/api/integrations/google-sheets/practice-map',
    { method: 'PUT', body: JSON.stringify({ sheet_value: sheetValue, practice_id: practiceId }) },
  );
}

export function syncSheetsNow() {
  return api<{ started: boolean }>('/api/integrations/google-sheets/sync', { method: 'POST' });
}

export function disconnectSheets() {
  return api<{ ok: boolean }>('/api/integrations/google-sheets', { method: 'DELETE' });
}
