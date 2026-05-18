import { api } from '@/lib/api';

export function openBillingPortal() {
  return api('/api/billing/portal', { method: 'POST' });
}
