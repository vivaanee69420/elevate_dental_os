'use client';

import { useEffect, useState } from 'react';
import { PageHeader, DataTable, type Column } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

type Row = { provider: string; connected: number; error: number; total: number };

export default function PlatformIntegrationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi<Row[]>('/metrics/integrations')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  const columns: Column<Row>[] = [
    { header: 'Provider',  render: (r) => r.provider },
    { header: 'Connected', align: 'right', render: (r) => String(r.connected) },
    { header: 'Errors',    align: 'right', render: (r) => String(r.error) },
    { header: 'Total',     align: 'right', render: (r) => String(r.total) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Integrations health" subtitle="Per-provider connection counts across all tenants." />
      {error && <div className="text-sm text-danger">{error}</div>}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.provider} empty={<div className="p-6 text-center text-ink-muted">No integrations recorded.</div>} />
    </div>
  );
}
