import { api } from '@/lib/api';

export interface CrmTreatment {
  name: string;
  default_value_pence: number;
}

export interface CrmSettings {
  organisation_id: string;
  treatments: CrmTreatment[];
  sources: string[];
  payment_plans: string[];
  gdpr_default_basis: 'consent' | 'legitimate_interest' | 'contract' | 'none';
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_tz: string;
  marketing_default_consent: boolean;
  updated_at: string;
}

export interface CrmSettingsCounts {
  template_count: number;
  active_sequence_count: number;
  treatment_count: number;
  source_count: number;
}

export interface CrmSettingsResponse {
  settings: CrmSettings;
  counts: CrmSettingsCounts;
}

export function getCrmSettings() {
  return api<CrmSettingsResponse>('/api/crm/settings');
}

export function updateCrmSettings(patch: Partial<Omit<CrmSettings, 'organisation_id' | 'updated_at'>>) {
  return api<CrmSettingsResponse>('/api/crm/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}
