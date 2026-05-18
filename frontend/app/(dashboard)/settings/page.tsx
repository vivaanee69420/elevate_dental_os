'use client';
import { api } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';

export default function SettingsPage() {
  const billingPortal = useMutation({
    mutationFn: () => api('/api/billing/portal', { method: 'POST' }),
    onSuccess: (data: any) => { window.location.href = data.url; },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="display text-3xl font-bold">Settings</h1>
      <p className="text-sm text-ink-muted mb-6">Organisation, billing, team</p>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-2">Billing</h2>
        <p className="text-sm text-ink-muted mb-4">Manage subscription, payment method, invoices</p>
        <button onClick={() => billingPortal.mutate()} className="btn-primary">
          {billingPortal.isPending ? 'Loading…' : 'Open billing portal →'}
        </button>
      </div>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-2">Team</h2>
        <p className="text-sm text-ink-muted">Invite users, set roles, manage permissions</p>
        <a href="/team-permissions" className="text-brand hover:underline text-sm mt-2 inline-block">Go to Team Permissions →</a>
      </div>
    </div>
  );
}
