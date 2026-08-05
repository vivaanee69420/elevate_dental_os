import { api } from '@/lib/api';

// ---- Call Reporting dashboard ----------------------------------------------

export interface DashboardSourceInfo {
  id: string;
  practice_label: string | null;
  status: 'pending' | 'active' | 'failed';
  last_synced_at: string | null;
  mapped: boolean;
}

export interface CallReportingDashboard {
  configured: boolean;
  date: string;
  sourceId: string | null;
  totalLeads: number;
  calledWithin3m: number;
  calledWithin10m: number;
  efficiencyPct: number;
  leadsInPipeline: number;
  notCalled: number;
  officeTimeLeads: number;
  outsideOfficeTime: number;
  facebookLeads: number;
  googleLeads: number;
  sources: DashboardSourceInfo[];
  syncFailed: boolean;
  lastSyncedAt: string | null;
  topUpOk: boolean;
}

const EMPTY: CallReportingDashboard = {
  configured: false,
  date: '',
  sourceId: null,
  totalLeads: 0,
  calledWithin3m: 0,
  calledWithin10m: 0,
  efficiencyPct: 0,
  leadsInPipeline: 0,
  notCalled: 0,
  officeTimeLeads: 0,
  outsideOfficeTime: 0,
  facebookLeads: 0,
  googleLeads: 0,
  sources: [],
  syncFailed: false,
  lastSyncedAt: null,
  topUpOk: true,
};

export function fetchCallReportingDashboard(date: string, sourceId?: string): Promise<CallReportingDashboard> {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (sourceId) qs.set('source', sourceId);
  const q = qs.toString();
  return api<CallReportingDashboard>(`/api/call-reporting/dashboard${q ? `?${q}` : ''}`)
    .then((r) => ({ ...EMPTY, ...r }));
}

// ---- Google Sheets connection / setup --------------------------------------

export interface SheetSourceInfo {
  id: string;
  practice_label: string | null;
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
  mapped: boolean;
}

export interface SheetsStatus {
  connected: boolean;
  connectionStatus: string | null;
  connectionError: string | null;
  sources: SheetSourceInfo[];
}

export function fetchSheetsStatus() {
  return api<SheetsStatus>('/api/integrations/google-sheets/status');
}

// Google Picker bootstrap (browse-and-pick instead of paste-URL). `enabled` is
// false until the operator sets GOOGLE_PICKER_API_KEY on the backend. The
// access token is short-lived — fetch fresh right before opening the picker.
export interface SheetsPickerConfig {
  enabled: boolean;
  apiKey?: string;
  appId?: string | null;
  accessToken?: string;
}

export function fetchSheetsPickerConfig() {
  return api<SheetsPickerConfig>('/api/integrations/google-sheets/picker-config');
}

export function addSheetSource({ url, practiceLabel }: { url: string; practiceLabel: string }) {
  return api<{ ok: boolean; id: string; title: string | null; tabs: string[] }>(
    '/api/integrations/google-sheets/sources',
    { method: 'POST', body: JSON.stringify({ url, practice_label: practiceLabel }) },
  );
}

export function fetchSheetPreview(sourceId: string, tab: string) {
  return api<{ tab: string; rows: string[][] }>(
    `/api/integrations/google-sheets/sources/${sourceId}/preview?tab=${encodeURIComponent(tab)}`,
  );
}

export interface SheetMappingInput {
  tab_name: string;
  header_row: number;
  columns: {
    date: number;
    created_time: number;
    called_3m: number;
    called_10m: number;
    pipeline_name: number;
  };
}

export function saveSheetMapping(sourceId: string, mapping: SheetMappingInput) {
  return api<{ ok: boolean; syncStarted: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}/mapping`,
    { method: 'PUT', body: JSON.stringify(mapping) },
  );
}

export function syncSheetSource(sourceId: string) {
  return api<{ started: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}/sync`,
    { method: 'POST' },
  );
}

export function removeSheetSource(sourceId: string) {
  return api<{ ok: boolean }>(
    `/api/integrations/google-sheets/sources/${sourceId}`,
    { method: 'DELETE' },
  );
}

export function disconnectSheets() {
  return api<{ ok: boolean }>('/api/integrations/google-sheets', { method: 'DELETE' });
}
