'use client';

import { PageHeader, DataTable, type Column } from '@/components/ui';
import { useIntegrationHealth } from '@/features/platform/hooks';
import type { IntegrationHealthRow as Row } from '@/features/platform/api';

export default function PlatformIntegrationsPage() {
  const { data, error } = useIntegrationHealth();
  const rows = data ?? [];

  const columns: Column<Row>[] = [
    { header: 'Provider',  render: (r) => r.provider },
    { header: 'Connected', align: 'right', render: (r) => String(r.connected) },
    { header: 'Errors',    align: 'right', render: (r) => String(r.error) },
    { header: 'Total',     align: 'right', render: (r) => String(r.total) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Integrations health" subtitle="Per-provider connection counts across all tenants." />
      {error && <div className="text-sm text-danger">{(error as Error).message}</div>}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.provider} empty={<div className="p-6 text-center text-ink-muted">No integrations recorded.</div>} />
    </div>
  );
}
