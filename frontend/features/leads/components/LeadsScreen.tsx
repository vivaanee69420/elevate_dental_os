'use client';
import { PageHeader, DataTable, StatusBadge, EmptyState, type Column } from '@/components/ui';
import { formatPence, formatDate } from '@/lib/format';
import { useLeads } from '../hooks';

const columns: Column<any>[] = [
  { header: 'Name', render: (l) => `${l.contact?.first_name ?? ''} ${l.contact?.last_name ?? ''}` },
  { header: 'Treatment', render: (l) => l.treatment },
  { header: 'Value', render: (l) => formatPence(l.estimated_value_pence) },
  {
    header: 'Status',
    render: (l) => <StatusBadge tone="brand">{String(l.status).replace(/_/g, ' ')}</StatusBadge>,
  },
  { header: 'Source', render: (l) => <span className="text-ink-muted">{l.source || '—'}</span> },
  {
    header: 'Created',
    render: (l) => <span className="text-ink-muted">{formatDate(l.created_at)}</span>,
  },
];

export default function LeadsScreen() {
  const { data } = useLeads();
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Leads" subtitle="All enquiries across practices" />
      <DataTable
        columns={columns}
        rows={data?.leads}
        rowKey={(l) => l.id}
        empty={<EmptyState icon="📥" message="No leads yet" />}
      />
    </div>
  );
}
