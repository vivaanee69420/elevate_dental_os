'use client';
import { PageHeader, Card } from '@/components/ui';
import { useBillingPortal } from '../hooks';

export default function SettingsScreen() {
  const billingPortal = useBillingPortal();
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Organisation, billing, team" />

      <Card className="mb-4">
        <h2 className="display text-lg font-semibold mb-2">Billing</h2>
        <p className="text-sm text-ink-muted mb-4">
          Manage subscription, payment method, invoices
        </p>
        <button onClick={() => billingPortal.mutate()} className="btn-primary">
          {billingPortal.isPending ? 'Loading…' : 'Open billing portal →'}
        </button>
      </Card>

      <Card className="mb-4">
        <h2 className="display text-lg font-semibold mb-2">Team</h2>
        <p className="text-sm text-ink-muted">
          Invite users, set roles, manage permissions
        </p>
        <a
          href="/team-permissions"
          className="text-brand hover:underline text-sm mt-2 inline-block"
        >
          Go to Team Permissions →
        </a>
      </Card>
    </div>
  );
}
