'use client';
// The one table for marketing leads, shared by the leads screen and the
// campaign detail page so the two can never show the same person differently.
//
// NOT features/cockpit/components/LeadsTable: that is typed to CockpitLeadLine
// (pipeline name, treatment-accepted value) and bending a marketing row into it
// would cost the Stage column, which is the point of the campaign drill-down.
import { StatusBadge } from '@/components/ui';
import { usePractices } from '@/features/practices/hooks';
import { CHANNEL_COLOUR, CHANNEL_LABEL, STAGE_LABEL, type MarketingLead } from '../api';

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function MarketingLeadsTable({ rows }: { rows: MarketingLead[] }) {
  const { data: practiceData } = usePractices();
  const practiceName = (id: string | null) => (id
    ? practiceData?.practices?.find((p) => p.id === id)?.name ?? '—'
    : '—');

  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface">
      <table className="w-full text-[13.5px]">
        <thead className="bg-bg">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Name</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Enquired</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Practice</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Outcome</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Stage reached</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.contactId} className="border-t border-border hover:bg-bg">
              <td className="px-4 py-3">
                <div className="font-medium text-ink">{r.name ?? 'Name not recorded'}</div>
                {r.email || r.phone ? (
                  <div className="mt-0.5 text-[12.5px] text-ink-muted">
                    {r.email ?? r.phone}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-ink-muted">{formatWhen(r.enquiredAt)}</td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: CHANNEL_COLOUR[r.channel] }}
                  />
                  {CHANNEL_LABEL[r.channel] ?? r.channel}
                </span>
                {r.attributionSource ? (
                  <div className="mt-0.5 text-[12.5px] text-ink-muted">{r.attributionSource}</div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {r.campaignName ?? (r.campaignId ? r.campaignId : '—')}
              </td>
              <td className="px-4 py-3 text-ink-muted">{practiceName(r.practiceId)}</td>
              <td className="px-4 py-3">
                {r.isNewPatient ? (
                  <StatusBadge tone="success">New patient</StatusBadge>
                ) : r.converted ? (
                  <span className="text-ink-muted">Existing patient</span>
                ) : (
                  <span className="text-ink-muted">Enquiry only</span>
                )}
              </td>
              <td className="px-4 py-3">
                <StatusBadge>{STAGE_LABEL[r.stage]}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
