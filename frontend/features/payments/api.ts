import { api } from '@/lib/api';

export function listPayments() {
  return api('/api/payments');
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
