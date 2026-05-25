'use client';

import { useEffect, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

type Row = {
  id: string;
  organisation_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  created_at: string;
};

export default function PlatformAuditPage() {
  const [rows, setRows]   = useState<Row[]>([]);
  const [action, setAction] = useState('');
  const [orgId, setOrgId]   = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (action) params.set('action', action);
    if (orgId)  params.set('organisation_id', orgId);
    platformApi<{ rows: Row[]; total: number }>(`/audit?${params}`)
      .then((d) => setRows(d.rows))
      .catch((e) => setError(e.message));
  }, [action, orgId]);

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

      {error && <div className="text-sm text-danger">{error}</div>}

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={<div className="p-6 text-center text-ink-muted">No audit entries.</div>} />
    </div>
  );
}
