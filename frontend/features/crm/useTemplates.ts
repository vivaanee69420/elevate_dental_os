'use client';
// CRM message-templates hook — reads the REAL per-org templates from
// /api/crm/templates. Replaces the static TEMPLATES mock in ./data.
import { useQuery } from '@tanstack/react-query';
import { listTemplates, type TemplatesResponse } from './api/templates';

export function useTemplates() {
  return useQuery<TemplatesResponse>({
    queryKey: ['crm-templates'],
    queryFn: () => listTemplates(),
    staleTime: 60_000,
  });
}
