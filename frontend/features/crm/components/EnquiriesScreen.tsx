'use client';
// Treatment Enquiries — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES['crm-enquiries'] at ~line 14580). A filterable table of
// per-lead treatment enquiries with value, payment plan, journey status and
// consultation date.
//
// Data flow:
//   buildEnquiries() joined to LEADS by leadId
//     -> filter by treatment + status selects
//     -> table rows + headline counters (count / active / total value)

import { useMemo, useState } from 'react';
import { Card, DataTable, EmptyState, type Column } from '@/components/ui';
import {
  buildEnquiries,
  LEADS,
  TREATMENTS,
  JOURNEY_STATUSES,
  journeyStyle,
  formatCurrency,
  formatDateTime,
  leadFullName,
  type Enquiry,
} from '../data';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

/** Index leads by id for row joins. */
const LEAD_BY_ID = Object.fromEntries(LEADS.map((l) => [l.id, l]));

/** Small inline journey-status pill (prototype getJourneyChip). */
function StatusPill({ status }: { status: string }) {
  const s = journeyStyle(status);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 8px',
        background: s.bg,
        color: s.colour,
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}

/** Treatment Enquiries screen. */
export default function EnquiriesScreen() {
  const [treatment, setTreatment] = useState('all');
  const [status, setStatus] = useState('all');
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  const all = useMemo(() => buildEnquiries(), []);

  const selectedAccount = ghlData?.accounts.find((a) => a.id === accountId);
  const selectedLabel = selectedAccount?.label ?? '';

  // Apply the two prototype filters + GHL subaccount label mock filter.
  const filtered = useMemo(
    () =>
      all.filter((e) => {
        if (treatment !== 'all' && e.treatment !== treatment) return false;
        if (status !== 'all' && e.journeyStatus !== status) return false;
        if (selectedLabel) {
          const l = LEAD_BY_ID[e.leadId];
          if (!l) return false;
          const labelClean = selectedLabel.toLowerCase().replace(/\s+/g, '');
          const practiceClean = (l.practice ?? '').toLowerCase().replace(/\s+/g, '');
          if (!practiceClean.includes(labelClean) && !labelClean.includes(practiceClean)) {
            return false;
          }
        }
        return true;
      }),
    [all, treatment, status, selectedLabel],
  );

  const totalValue = filtered.reduce((s, e) => s + e.value, 0);
  const active = filtered.filter(
    (e) => !['not_proceeding', 'treatment_completed'].includes(e.journeyStatus),
  ).length;

  // Table columns mirror the prototype's enquiry table.
  const columns: Column<Enquiry>[] = [
    {
      header: 'Patient',
      render: (e) => {
        const l = LEAD_BY_ID[e.leadId];
        return (
          <div>
            <div style={{ fontWeight: 600 }}>{l ? leadFullName(l) : '—'}</div>
            <div className="text-ink-muted" style={{ fontSize: 11 }}>
              {l?.phone}
            </div>
          </div>
        );
      },
    },
    { header: 'Treatment', render: (e) => e.treatment },
    {
      header: 'Value',
      align: 'right',
      render: (e) => (
        <span style={{ fontWeight: 600 }}>{formatCurrency(e.value)}</span>
      ),
    },
    {
      header: 'Payment plan',
      render: (e) => (
        <span className="text-ink-muted">{e.paymentPlan}</span>
      ),
    },
    { header: 'Status', render: (e) => <StatusPill status={e.journeyStatus} /> },
    {
      header: 'Consultation',
      render: (e) => (
        <span className="text-ink-muted">
          {e.consultationAt ? formatDateTime(e.consultationAt) : '—'}
        </span>
      ),
    },
    {
      header: 'Practice',
      render: (e) => (
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          {LEAD_BY_ID[e.leadId]?.practice}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Treatment Enquiries
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {filtered.length} enquiries · {active} active ·{' '}
          {formatCurrency(totalValue)} total value
        </p>
      </div>

      {ghlData && ghlData.accounts.length > 0 && (
        <div className="mb-4">
          <SubaccountFilterBar
            accounts={ghlData.accounts.map((a) => ({
              accountId: a.id,
              label: a.label || 'GoHighLevel',
              practiceId: a.practice_id ?? null,
            })) as any}
            selected={accountId}
            onSelect={setAccountId}
          />
        </div>
      )}

      {/* Filters */}
      <div
        className="flex"
        style={{ gap: 10, alignItems: 'center', marginBottom: 12 }}
      >
        <select
          value={treatment}
          onChange={(e) => setTreatment(e.target.value)}
          style={{
            padding: 7,
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <option value="all">All treatments</option>
          {TREATMENTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{
            padding: 7,
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <option value="all">All statuses</option>
          {JOURNEY_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(e) => e.id}
          empty={
            <EmptyState message="No enquiries match your filters" />
          }
        />
      </Card>
    </div>
  );
}
