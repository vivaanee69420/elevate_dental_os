import { api } from '@/lib/api';

export function listLeads() {
  return api('/api/leads?limit=100');
}
