'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { useOrgs, useCreateOrgWithOwner } from '@/features/platform/hooks';
import type { OrgRow as Org, CreatedOwner } from '@/features/platform/api';

export default function PlatformOrgsPage() {
  const [q, setQ]           = useState('');

  // Create-owner form state.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]   = useState({ email: '', full_name: '', organisation_name: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOwner | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '100' });
    if (q) p.set('q', q);
    return p;
  }, [q]);

  const { data, error: loadError } = useOrgs(params);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const error = loadError ? (loadError as Error).message : null;

  // The mutation invalidates the org list itself, so the manual refresh
  // counter this replaces is no longer needed.
  const createM = useCreateOrgWithOwner();
  const creating = createM.isPending;

  async function createOwner(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    try {
      const out = await createM.mutateAsync(form);
      setCreated(out);
      setForm({ email: '', full_name: '', organisation_name: '' });
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  const columns: Column<Org>[] = [
    { header: 'Name', render: (r) => (
      <Link href={`/platform/orgs/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
    )},
    { header: 'Slug', render: (r) => <span className="text-ink-muted">{r.slug}</span> },
    { header: 'Plan', render: (r) => r.plan ?? '—' },
    { header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString('en-GB') },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Organisations" subtitle={`${total} tenants total.`} />

      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border border-border rounded px-3 py-2 text-sm w-72"
        />
        <button
          onClick={() => { setShowForm((s) => !s); setCreated(null); setFormError(null); }}
          className="px-3 py-2 rounded text-sm font-semibold bg-brand text-white"
        >
          {showForm ? 'Cancel' : 'New owner + org'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createOwner} className="border border-border rounded p-4 space-y-3 max-w-xl">
          <div className="text-sm font-semibold">Create owner + organisation</div>
          <p className="text-xs text-ink-muted">
            The owner is active immediately. A one-time password is generated and shown
            once below — copy it and hand it over. The owner changes it after first login.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Owner full name
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              Owner email
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="text-sm block">
            Organisation name
            <input
              required
              value={form.organisation_name}
              onChange={(e) => setForm({ ...form, organisation_name: e.target.value })}
              className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
            />
          </label>
          {formError && <div className="text-sm text-danger">{formError}</div>}
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create owner'}
          </button>
        </form>
      )}

      {created && (
        <div className="border border-emerald-300 bg-emerald-50 rounded p-4 max-w-xl space-y-1">
          <div className="text-sm font-semibold text-emerald-800">Owner created — hand over these credentials</div>
          <div className="text-sm">Email: <span className="font-mono">{created.email}</span></div>
          <div className="text-sm">Temporary password: <span className="font-mono select-all">{created.temp_password}</span></div>
          <div className="text-xs text-ink-muted">Shown once. It is not stored anywhere and cannot be retrieved again.</div>
        </div>
      )}

      {error && <div className="text-sm text-danger">{error}</div>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<div className="p-6 text-center text-ink-muted">No organisations.</div>}
      />
    </div>
  );
}
