'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader, Card, DataTable, type Column } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

type Org = { id: string; name: string; slug: string; plan: string | null; created_at: string; user_count: number };
type User = { id: string; email: string; full_name: string | null; role: string; status: string | null; last_seen_at: string | null };
type Activity = { id: string; user_id: string | null; action: string; entity_type: string; created_at: string };

export default function PlatformOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg]           = useState<Org | null>(null);
  const [users, setUsers]       = useState<User[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      platformApi<Org>(`/orgs/${id}`),
      platformApi<User[]>(`/orgs/${id}/users`),
      platformApi<Activity[]>(`/orgs/${id}/activity`),
    ])
      .then(([o, u, a]) => { setOrg(o); setUsers(u); setActivity(a); })
      .catch((e) => setError(e.message));
  }, [id]);

  const userCols: Column<User>[] = [
    { header: 'Email',    render: (r) => r.email },
    { header: 'Name',     render: (r) => r.full_name ?? '—' },
    { header: 'Role',     render: (r) => r.role },
    { header: 'Status',   render: (r) => r.status ?? '—' },
    { header: 'Last seen', render: (r) => r.last_seen_at ? new Date(r.last_seen_at).toLocaleString('en-GB') : '—' },
  ];

  const actCols: Column<Activity>[] = [
    { header: 'When',   render: (r) => new Date(r.created_at).toLocaleString('en-GB') },
    { header: 'User',   render: (r) => r.user_id ?? '—' },
    { header: 'Action', render: (r) => r.action },
    { header: 'Entity', render: (r) => r.entity_type },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={org ? org.name : 'Organisation'} subtitle={org ? `${org.slug} · ${org.user_count} users · created ${new Date(org.created_at).toLocaleDateString('en-GB')}` : 'Loading…'} />

      {error && <div className="text-sm text-danger">{error}</div>}

      <Card>
        <h2 className="font-semibold mb-3">Users in this organisation</h2>
        <DataTable columns={userCols} rows={users} rowKey={(r) => r.id} empty={<div className="p-4 text-ink-muted text-sm">No users.</div>} />
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Recent activity</h2>
        <DataTable columns={actCols} rows={activity} rowKey={(r) => r.id} empty={<div className="p-4 text-ink-muted text-sm">No activity recorded yet.</div>} />
      </Card>
    </div>
  );
}
