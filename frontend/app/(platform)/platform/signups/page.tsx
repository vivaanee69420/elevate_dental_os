'use client';

import { useEffect, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

type Signup = {
  id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  organisation_name: string | null;
  organisation_slug: string | null;
  status: string;
  created_at: string;
};

export default function PlatformSignupsPage() {
  const [rows, setRows]     = useState<Signup[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);
  const [loading, setLoad]  = useState(true);

  function load() {
    setLoad(true);
    platformApi<Signup[]>('/signups')
      .then((d) => { setRows(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoad(false));
  }

  useEffect(load, []);

  async function act(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !window.confirm('Reject this signup? The owner will never be able to log in.')) {
      return;
    }
    setBusy(id);
    try {
      await platformApi(`/signups/${id}/${action}`, { method: 'POST' });
      // Drop the row locally — it leaves the pending queue either way.
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      setError(e.message);
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
          className="px-3 py-1 rounded text-xs font-semibold bg-primary text-white disabled:opacity-50"
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
