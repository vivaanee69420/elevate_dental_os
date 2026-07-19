import { api } from '@/lib/api';

// Matches ad_metrics.provider so spend and leads join without translation.
export type AdChannel = 'google_ads' | 'meta_ads';

export interface SubaccountRow {
  id: string;
  label: string;
  locationId: string;
  status: string | null;
  practiceId: string | null;
  practiceName: string | null;
  pipelineCount: number;
  leadCount: number;
}

export interface PipelineRow {
  accountId: string;
  accountLabel: string;
  practiceId: string | null;
  practiceName: string | null;
  pipelineId: string;
  pipelineName: string;
  /** null = unassigned. Never inferred from the pipeline name. */
  channel: AdChannel | null;
  leadCount: number;
}

export interface AdAccountRow {
  id: string;
  provider: string;
  customerId: string;
  name: string | null;
  practiceId: string | null;
  practiceName: string | null;
}

export interface AdAttributionConfig {
  practices: Array<{ id: string; name: string }>;
  subaccounts: SubaccountRow[];
  pipelines: PipelineRow[];
  adAccounts: AdAccountRow[];
}

export function fetchAdAttributionConfig() {
  return api<AdAttributionConfig>('/api/ad-attribution/config');
}

export function setPipelineChannel(accountId: string, pipelineId: string, channel: AdChannel | null) {
  return api<{ ok: true }>(
    `/api/ad-attribution/pipelines/${accountId}/${encodeURIComponent(pipelineId)}`,
    { method: 'PUT', body: JSON.stringify({ channel }) },
  );
}

export function setSubaccountPractice(id: string, practiceId: string | null) {
  return api<{ ok: true }>(`/api/ad-attribution/subaccounts/${id}`, {
    method: 'PATCH', body: JSON.stringify({ practice_id: practiceId }),
  });
}

export function setAdAccountPractice(id: string, practiceId: string | null) {
  return api<{ ok: true }>(`/api/ad-attribution/ad-accounts/${id}`, {
    method: 'PATCH', body: JSON.stringify({ practice_id: practiceId }),
  });
}
