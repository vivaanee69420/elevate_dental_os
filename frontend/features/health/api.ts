import { api } from '@/lib/api';

export function getHealth() {
  return api('/api/health');
}

export function updateHealth(payload: any) {
  return api('/api/health', { method: 'PUT', body: JSON.stringify(payload) });
}

export function getHealthProgress() {
  return api('/api/health/progress');
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
