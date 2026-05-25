import { api } from '@/lib/api';

export interface PaymentsPage {
  payments: any[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function listPayments(page = 1, limit = 25, practiceId?: string | null) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  return api<PaymentsPage>(`/api/payments?page=${page}&limit=${limit}${pp}`);
}

export interface PaymentSummary {
  today: number;
  week: number;
  month: number;
  outstanding: number;
}

export function getPaymentSummary(practiceId?: string | null) {
  const pp = practiceId ? `?practice_id=${practiceId}` : '';
  return api<PaymentSummary>(`/api/payments/summary${pp}`);
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
