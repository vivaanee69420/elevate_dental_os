'use client';
import { PageHeader, Card } from '@/components/ui';
import { useBillingPortal } from '../hooks';

export default function BillingScreen() {
  const billingPortal = useBillingPortal();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Billing" subtitle="Subscription, payment method, invoices" />
      <Card>
        <p className="text-sm text-ink-muted mb-4">
          Manage your subscription, payment method and invoices in the billing portal.
        </p>
        <button onClick={() => billingPortal.mutate()} className="btn-primary">
          {billingPortal.isPending ? 'Loading…' : 'Open billing portal →'}
        </button>
      </Card>
    </div>
  );
}
