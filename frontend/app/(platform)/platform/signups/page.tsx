'use client';

import { useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { useSignups, useActOnSignup } from '@/features/platform/hooks';
import type { Signup } from '@/features/platform/api';

export default function PlatformSignupsPage() {
  const { data, isPending: loading, error: loadError } = useSignups();
  const rows = data ?? [];
  const actM = useActOnSignup();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const error = actionError ?? (loadError ? (loadError as Error).message : null);

  async function act(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this signup? The owner will never be able to log in.')) {
      return;
    }
    setBusy(id);
    setActionError(null);
    try {
      // Refetches the queue rather than dropping the row locally. Approving
      // also creates a user and touches the org, and the mutation invalidates
      // those lists too — the Users page used to stay stale until a reload.
      await actM.mutateAsync({ id, action });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Signup>[] = [
    { header: 'Organisation', render: (r) => r.organisation_name ?? r.organisation_slug ?? '—' },
    { header: 'Owner',        render: (r) => r.full_name },
    { header: 'Email',        render: (r) => <span className="text-ink-muted">{r.email}</span> },
    { header: 'Signed up',    render: (r) => new Date(r.created_at).toLocaleString('en-GB') },
    { header: '', render: (r) => (
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => act(r.id, 'approve')}
          disabled={busy === r.id}
          className="px-3 py-1 rounded text-xs font-semibold bg-brand text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => act(r.id, 'reject')}
          disabled={busy === r.id}
          className="px-3 py-1 rounded text-xs font-semibold border border-danger text-danger disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pending signups"
        subtitle="Self-registered owners awaiting approval. They cannot log in until approved."
      />

      {error && <div className="text-sm text-danger">{error}</div>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <div className="p-6 text-center text-ink-muted">
            {loading ? 'Loading…' : 'No pending signups.'}
          </div>
        }
      />
    </div>
  );
}
