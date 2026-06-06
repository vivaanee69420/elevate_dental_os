import { api } from '@/lib/api';

export function getHealth() {
  return api('/api/health');
}

export function updateHealth(payload: any) {
  return api('/api/health', { method: 'PUT', body: JSON.stringify(payload) });
}

// `asOf` (YYYY-MM-DD) rewinds manual baseline/targets/KPIs to what they were on
// that date (000054 history); omit for the live current values.
export function getHealthProgress(asOf?: string) {
  return api(`/api/health/progress${asOf ? `?asOf=${asOf}` : ''}`);
}

export function getHealthInsights() {
  return api('/api/health/insights');
}

export type SnapshotFrequency = 'weekly' | 'monthly';

export function updateCadence(snapshot_frequency: SnapshotFrequency) {
  return api<{ ok: boolean; snapshot_frequency: SnapshotFrequency }>(
    '/api/health/cadence',
    { method: 'PATCH', body: JSON.stringify({ snapshot_frequency }) },
  );
}

export function listSnapshots() {
  return api<{ snapshots: Array<{ id: string; snapshot_date: string; label: string; metrics: Record<string, any> }> }>(
    '/api/health/snapshots',
  );
}

export interface HealthMetric {
  key: string;
  label: string;
  cat: 'Financial' | 'Patient' | 'Conversion' | 'Operational';
  unit: '£' | '%' | 'min' | '';
  better: 'higher' | 'lower';
  sourceType: 'auto' | 'manual';
  source: string;
  asof: string | null;
  needsInput: boolean;
  baseline: number | null;
  current: number | null;
  target: number | null;
  progressPct: number;
  deltaFromBaselinePct: number;
  remainingToTarget: number | null;
}

export function getMetrics(asOf?: string) {
  return api<{ metrics: HealthMetric[] }>(`/api/health/metrics${asOf ? `?asOf=${asOf}` : ''}`);
}

export function updateMetric(key: string, value: number) {
  return api<{ value: number; asof: string }>(`/api/health/metrics/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}
