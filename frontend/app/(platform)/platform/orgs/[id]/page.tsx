'use client';

import { useParams } from 'next/navigation';
import { PageHeader, Card, DataTable, type Column } from '@/components/ui';
import { useOrg, useOrgUsers, useOrgActivity } from '@/features/platform/hooks';
import type {
  OrgDetail as Org, OrgUser as User, OrgActivity as Activity,
} from '@/features/platform/api';

export default function PlatformOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  // Three independent queries, not one Promise.all. Under Promise.all a single
  // failing request blanked the whole page, including the two that succeeded;
  // now each section renders or fails on its own.
  const orgQ = useOrg(id);
  const usersQ = useOrgUsers(id);
  const activityQ = useOrgActivity(id);

  const org = orgQ.data ?? null;
  const users = usersQ.data ?? [];
  const activity = activityQ.data ?? [];
  const firstError = orgQ.error ?? usersQ.error ?? activityQ.error;
  const error = firstError ? (firstError as Error).message : null;

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
