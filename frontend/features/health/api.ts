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
