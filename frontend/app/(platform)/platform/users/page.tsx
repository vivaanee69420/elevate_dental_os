'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

type User = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  organisation_id: string;
  status: string | null;
  created_at: string;
};

export default function PlatformUsersPage() {
  const [q, setQ]       = useState('');
  const [rows, setRows] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.length < 2) { setRows([]); return; }
    const params = new URLSearchParams({ q, limit: '50' });
    platformApi<User[]>(`/users?${params}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [q]);

  const columns: Column<User>[] = [
    { header: 'Email',  render: (r) => r.email },
    { header: 'Name',   render: (r) => r.full_name ?? '—' },
    { header: 'Role',   render: (r) => r.role },
    { header: 'Status', render: (r) => r.status ?? '—' },
    { header: 'Organisation', render: (r) => (
      <Link href={`/platform/orgs/${r.organisation_id}`} className="text-primary hover:underline font-mono text-xs">
        {r.organisation_id.slice(0, 8)}…
      </Link>
    )},
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Users" subtitle="Global search across all tenants." />
      <input
        type="search"
        placeholder="Search by email (min 2 chars)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="border border-border rounded px-3 py-2 text-sm w-72"
      />
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
