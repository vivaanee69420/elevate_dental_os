import { formatPence, formatNumber } from '@/lib/format';
import type { GhlTotals } from '../api';

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function GhlKpiCards({ totals }: { totals: GhlTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Card label="Contacts" value={formatNumber(totals.contacts.total)} sub={`${formatNumber(totals.contacts.new)} new`} />
      <Card label="Leads" value={formatNumber(totals.leads.total)} sub={`${formatNumber(totals.leads.open)} open`} />
      <Card label="Pipeline value" value={formatPence(totals.leads.pipelineValuePence)} />
      <Card label="Conversion" value={`${totals.leads.conversionPct}%`} sub={`${formatNumber(totals.leads.won)} won / ${formatNumber(totals.leads.lost)} lost`} />
      <Card label="Conversations" value={formatNumber(totals.conversations.total)} sub={`${formatNumber(totals.conversations.inbound)} in / ${formatNumber(totals.conversations.outbound)} out`} />
      <Card label="Sync health" value={`${totals.sync.active}/${totals.sync.accounts}`} sub="active subaccounts" />
    </div>
  );
}
