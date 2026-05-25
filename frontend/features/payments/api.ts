import { api } from '@/lib/api';

export interface PaymentsPage {
  payments: any[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PaymentFilters {
  practiceId?: string | null;
  status?: string | null; // settled | pending | processing | failed | refunded | disputed
  since?: string | null; // YYYY-MM-DD (created_at >=)
  until?: string | null; // YYYY-MM-DD (created_at <=)
}

export function listPayments(page = 1, limit = 25, f: PaymentFilters = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (f.practiceId) qs.set('practice_id', f.practiceId);
  if (f.status) qs.set('status', f.status);
  if (f.since) qs.set('since', f.since);
  if (f.until) qs.set('until', f.until);
  return api<PaymentsPage>(`/api/payments?${qs.toString()}`);
}

export interface PaymentSummary {
  received: number; // settled in range (pence)
  outstanding: number; // all pending (pence)
  refunded: number; // refunded in range (pence)
  count: number; // transactions in range
}

// Summary follows the same practice + date filter as the list (status ignored).
export function getPaymentSummary(f: PaymentFilters = {}) {
  const qs = new URLSearchParams();
  if (f.practiceId) qs.set('practice_id', f.practiceId);
  if (f.since) qs.set('since', f.since);
  if (f.until) qs.set('until', f.until);
  const q = qs.toString();
  return api<PaymentSummary>(`/api/payments/summary${q ? `?${q}` : ''}`);
}

export interface CreateLinkInput {
  amount_pence: number;
  description: string;
  contact_id?: string;
  lead_id?: string;
}

// Backend creates a real Stripe Payment Link (needs STRIPE_SECRET_KEY) and
// records a pending payment row. Returns the Stripe-hosted URL.
export function createPaymentLink(input: CreateLinkInput) {
  return api('/api/payments/create-payment-link', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
