'use client';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { formatPence, formatDate } from '@/lib/format';
import { usePayments } from '../hooks';

const columns: Column<any>[] = [
  { header: 'Date', render: (p) => <span className="text-ink-muted">{formatDate(p.created_at)}</span> },
  { header: 'Patient', render: (p) => `${p.contact?.first_name ?? ''} ${p.contact?.last_name ?? ''}` },
  { header: 'Description', render: (p) => <span className="text-ink-muted">{p.description}</span> },
  {
    header: 'Amount',
    align: 'right',
    render: (p) => <span className="font-semibold">{formatPence(p.amount_pence)}</span>,
  },
  { header: 'Method', render: (p) => <span className="text-ink-muted">{p.method}</span> },
  {
    header: 'Status',
    render: (p) => (
      <StatusBadge tone={p.status === 'settled' ? 'success' : 'neutral'}>{p.status}</StatusBadge>
    ),
  },
];

export default function PaymentsScreen() {
  const { data } = usePayments();
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Patient Payments" subtitle="All transactions" />
      <DataTable columns={columns} rows={data?.payments} rowKey={(p) => p.id} />
    </div>
  );
}
