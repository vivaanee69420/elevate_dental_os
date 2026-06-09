import { api } from '@/lib/api';

export interface CrmTemplate {
  id: string;
  channel: 'sms' | 'email';
  name: string;
  subject: string | null;
  body: string;
  is_archived: boolean;
  created_at: string;
}

export interface TemplatesResponse {
  templates: CrmTemplate[];
}

export function listTemplates(channel?: 'sms' | 'email') {
  const qs = channel ? `?channel=${channel}` : '';
  return api<TemplatesResponse>(`/api/crm/templates${qs}`);
}

export function createTemplate(input: {
  channel: 'sms' | 'email';
  name: string;
  subject?: string | null;
  body: string;
}) {
  return api<CrmTemplate>('/api/crm/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTemplate(
  id: string,
  patch: Partial<{ channel: 'sms' | 'email'; name: string; subject: string | null; body: string; is_archived: boolean }>,
) {
  return api<CrmTemplate>(`/api/crm/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTemplate(id: string) {
  return api<{ success: boolean }>(`/api/crm/templates/${id}`, { method: 'DELETE' });
}
