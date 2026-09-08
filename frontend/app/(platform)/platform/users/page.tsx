'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { usePlatformUsers, useCreateOrgWithOwner } from '@/features/platform/hooks';
import type { PlatformUser as User, CreatedOwner } from '@/features/platform/api';

// A new platform-created user IS the owner of a new organisation. That owner
// then invites their own team members from the tenant Team UI — the platform
// admin only onboards the org + its first owner. Backed by POST /orgs.
export default function PlatformUsersPage() {
  const [q, setQ]       = useState('');

  // Create-owner form state (mirrors the Organisations page).
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', organisation_name: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOwner | null>(null);

  // Unchanged rule: no search below two characters.
  const searchable = q.length >= 2;
  const params = useMemo(() => new URLSearchParams({ q, limit: '50' }), [q]);
  const { data, error: loadError } = usePlatformUsers(params, searchable);
  const rows = searchable ? (data ?? []) : [];
  const error = loadError ? (loadError as Error).message : null;

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
      // Surface the new owner in the table straight away.
      setQ(out.email);
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  const columns: Column<User>[] = [
    { header: 'Email',  render: (r) => r.email },
    { header: 'Name',   render: (r) => r.full_name ?? '—' },
    { header: 'Role',   render: (r) => r.role },
    { header: 'Status', render: (r) => r.status ?? '—' },
    { header: 'Organisation', render: (r) => (
      <Link href={`/platform/orgs/${r.organisation_id}`} className="text-brand hover:underline font-mono text-xs">
        {r.organisation_id.slice(0, 8)}…
      </Link>
    )},
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Users" subtitle="Global search across all tenants." />

      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Search by email (min 2 chars)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border border-border rounded px-3 py-2 text-sm w-72"
        />
        <button
          onClick={() => { setShowForm((s) => !s); setCreated(null); setFormError(null); }}
          className="px-3 py-2 rounded text-sm font-semibold bg-brand text-white"
        >
          {showForm ? 'Cancel' : 'New user'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createOwner} className="border border-border rounded p-4 space-y-3 max-w-xl">
          <div className="text-sm font-semibold">Create user (organisation owner)</div>
          <p className="text-xs text-ink-muted">
            A new user is the owner of a new organisation, active immediately. A one-time
            password is generated and shown once below — copy it and hand it over. The owner
            changes it after first login, then invites their own team from the tenant Team page.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Full name
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              Email
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
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>
      )}

      {created && (
        <div className="border border-emerald-300 bg-emerald-50 rounded p-4 max-w-xl space-y-1">
          <div className="text-sm font-semibold text-emerald-800">User created — hand over these credentials</div>
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
        empty={<div className="p-6 text-center text-ink-muted">{q.length < 2 ? 'Type at least 2 characters to search.' : 'No users found.'}</div>}
      />
    </div>
  );
}
