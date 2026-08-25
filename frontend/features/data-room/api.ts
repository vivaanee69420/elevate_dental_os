import { api } from '@/lib/api';

export type DataRoomSourceKey = 'dentally' | 'google-ads' | 'meta-ads' | 'gohighlevel' | 'emergent';

export interface DataRoomColumn { col: string; pii: boolean }
export interface DataRoomDataset { key: string; label: string; roster: boolean; columns: DataRoomColumn[] }
export interface DataRoomSource { key: DataRoomSourceKey; label: string; description: string; datasets: DataRoomDataset[] }
export interface DataRoomRegistry { sources: DataRoomSource[] }

export type DataRoomRow = Record<string, unknown>;
export interface DataRoomPage { rows: DataRoomRow[]; next_cursor: string | null; total: number }

export interface DataRoomParams {
  scope: string;          // 'all' | practiceId
  since?: string;         // ISO; omitted for roster datasets
  until?: string;
  pii?: boolean;
}

const PROXY = '/api/backend';

function qs(p: DataRoomParams, extra: Record<string, string | number | undefined> = {}): string {
  const sp = new URLSearchParams({ scope: p.scope });
  if (p.since) sp.set('since', p.since);
  if (p.until) sp.set('until', p.until);
  if (p.pii) sp.set('pii', '1');
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') sp.set(k, String(v));
  return sp.toString();
}

export function fetchDataRoomRegistry(): Promise<DataRoomRegistry> {
  return api<DataRoomRegistry>('/api/data-room/datasets');
}

export function fetchDataRoomPage(
  source: DataRoomSourceKey,
  dataset: string,
  params: DataRoomParams,
  cursor: string | undefined,
  limit = 100,
): Promise<DataRoomPage> {
  return api<DataRoomPage>(`/api/data-room/${source}/${dataset}?${qs(params, { cursor, limit })}`);
}

/** Same-origin download href — the browser streams the CSV to disk. */
export function dataRoomExportUrl(source: DataRoomSourceKey, dataset: string, params: DataRoomParams): string {
  return `${PROXY}/api/data-room/${source}/${dataset}/export.csv?${qs(params)}`;
}
