import { api } from '@/lib/api';

export function listPayments() {
  return api('/api/payments');
}
