'use client';
import { PageHeader, DataTable, StatusBadge, EmptyState, type Column } from '@/components/ui';
import { formatPence, formatDate, formatNumber } from '@/lib/format';
import { useLeads } from '../hooks';
import { useMarketingRoi } from '@/features/growth/hooks';

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

/** A compact tile for the lead-acquisition strip. */
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

/** Cost-per-lead from paid ads (Google Ads now; Meta next), last 30 days.
 * Silent until ads are connected + synced, so the table is never pushed down
 * for orgs that don't run paid ads. */
function LeadAcquisition() {
  const { data, isLoading } = useMarketingRoi();
  if (isLoading || !data || !data.connected) return null;
  return (
    <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <Tile label="Ad spend (30d)" value={formatPence(data.spend_pence)} />
      <Tile label="Leads from ads" value={formatNumber(data.leads_from_ads)} sub={`of ${formatNumber(data.total_leads)} total`} />
      <Tile label="Cost / lead" value={data.cpl_pence ? formatPence(data.cpl_pence) : '—'} />
      <Tile label="Cost / new patient" value={data.cac_pence ? formatPence(data.cac_pence) : '—'} />
    </div>
  );
}

export default function LeadsScreen() {
  const { data } = useLeads();
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Leads" subtitle="All enquiries across practices" />
      <LeadAcquisition />
      <DataTable
        columns={columns}
        rows={data?.leads}
        rowKey={(l) => l.id}
        empty={<EmptyState icon="📥" message="No leads yet" />}
      />
    </div>
  );
}
