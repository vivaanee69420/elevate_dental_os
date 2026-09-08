'use client';

import { useMemo, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { useAudit } from '@/features/platform/hooks';
import type { AuditRow as Row } from '@/features/platform/api';

export default function PlatformAuditPage() {
  const [action, setAction] = useState('');
  const [orgId, setOrgId]   = useState('');

  // The filters ARE the cache key, so re-applying a filter you used a moment
  // ago is instant instead of a fresh round trip.
  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '200' });
    if (action) p.set('action', action);
    if (orgId)  p.set('organisation_id', orgId);
    return p;
  }, [action, orgId]);

  const { data, error } = useAudit(params);
  const rows = data?.rows ?? [];

  const columns: Column<Row>[] = [
    { header: 'When', render: (r) => new Date(r.created_at).toLocaleString('en-GB') },
    { header: 'Organisation', render: (r) => <span className="font-mono text-xs">{r.organisation_id.slice(0, 8)}…</span> },
    { header: 'User',   render: (r) => r.user_id ? <span className="font-mono text-xs">{r.user_id.slice(0, 8)}…</span> : '—' },
    { header: 'Action', render: (r) => r.action },
    { header: 'Entity', render: (r) => `${r.entity_type}${r.entity_id ? ' · ' + r.entity_id.slice(0, 8) : ''}` },
    { header: 'IP',     render: (r) => r.ip_address ?? '—' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Cross-tenant mutation log (tenant audit_log table)." />

      <div className="flex gap-3 text-sm">
        <input
          type="search"
          placeholder="Filter by action (e.g. create)…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="border border-border rounded px-3 py-2 w-60"
        />
        <input
          type="search"
          placeholder="Filter by organisation UUID…"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="border border-border rounded px-3 py-2 w-80"
        />
      </div>

      {error && <div className="text-sm text-danger">{(error as Error).message}</div>}

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={<div className="p-6 text-center text-ink-muted">No audit entries.</div>} />
    </div>
  );
}
