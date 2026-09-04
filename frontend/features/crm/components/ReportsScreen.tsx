'use client';
// CRM Reports — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES['crm-reports'] at ~line 14996). Four headline KPIs, a
// conversion funnel with drop-off, by-source and by-practice tables, and a
// by-treatment value grid.
//
// Data flow:
//   GET /api/leads/report -> one SQL aggregate over one window, returning
//        headline totals + the by-source and by-practice groupings, so the
//        funnel and both tables always agree with each other.

import { useMemo, useState } from 'react';
import { useLeadReport } from '@/features/leads/hooks';
import { useTreatmentBreakdown } from '@/features/crm/treatment-api';
import { formatPence as formatCurrency } from '@/lib/format';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

/** CRM Reports screen — live, derived from GET /api/leads/report. The "By treatment"
 *  card is backed by REAL Dentally invoiced fees (GET /api/analytics/treatment-breakdown),
 *  not the lead pipeline (leads carry GHL opp.name, not a real treatment). */
export default function ReportsScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  // Every figure below is server-aggregated (GET /api/leads/report). It used
  // to be counted in the browser from `useLeads({ limit: 1000 })` — and 1000 is
  // exactly PostgREST's row cap, so that bound was a ceiling dressed as a
  // choice. On 22,807 leads the page rendered "1,000 leads received" (22x out),
  // an FTA rate of 0.00% against a real 0.08%, and a pipeline value ~1/22 of
  // the truth. The conversion RATE happened to look right, which is what made
  // it hard to notice — a number that is right by luck is not right.
  const { data: report, isLoading } = useLeadReport({ accountId });
  const { data: treatmentData } = useTreatmentBreakdown(24);
  const treatmentBreakdown = treatmentData?.treatments ?? [];

  const model = useMemo(() => {
    const t = report?.totals;
    const COLOURS = ['#3B82F6', '#7C3AED', '#6366F1', '#0891B2', 'var(--success)'];
    return {
      totalLeads: t?.total ?? 0,
      treatmentStarted: t?.treatmentStarted ?? 0,
      pipelineValue: t?.pipelineValuePence ?? 0,
      avgFirstContact: t?.avgFirstResponseMinutes ?? null,
      ftaRate: t?.ftaPct ?? null,
      funnel: (report?.funnel ?? []).map((f, i) => ({
        label: f.label, value: f.count, colour: COLOURS[i] ?? COLOURS[0],
      })),
      sourceBreakdown: (report?.bySource ?? []).map((r) => ({
        name: r.key,
        leads: r.total,
        conversionRate: r.conversionPct ?? 0,
        value: r.convertedValuePence,
      })),
      // Includes the "Unassigned" bucket. The old client code grouped on
      // `l.practice?.name` and dropped falsy names, discarding every lead with
      // no practice — 3,939 of 22,807, holding 301 of the 494 conversions, so
      // this table was missing 61% of all conversions.
      practiceBreakdown: (report?.byPractice ?? []).map((r) => ({
        name: r.key,
        leads: r.total,
        conversionRate: r.conversionPct ?? 0,
      })),
    };
  }, [report]);

  const maxFunnel = model.totalLeads || 1;

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          CRM Reports
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {isLoading
            ? 'Loading…'
            : `${model.totalLeads.toLocaleString('en-GB')} leads · conversion funnel · source ROI · practice performance`}
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

      {/* 4 KPIs */}
      <div
        className="grid gap-3 mb-5"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        <div className="card-padded">
          <div
            className="text-ink-muted uppercase font-bold"
            style={{ fontSize: 10, letterSpacing: '0.05em' }}
          >
            Conversion rate
          </div>
          <div
            className="display font-bold"
            style={{ fontSize: 28, color: 'var(--success)', marginTop: 4 }}
          >
            {model.totalLeads
              ? ((model.treatmentStarted / model.totalLeads) * 100).toFixed(1)
              : 0}
            %
          </div>
          <div className="text-ink-muted" style={{ fontSize: 10 }}>
            {model.treatmentStarted} of {model.totalLeads} to treatment
          </div>
        </div>
        <div className="card-padded">
          <div
            className="text-ink-muted uppercase font-bold"
            style={{ fontSize: 10, letterSpacing: '0.05em' }}
          >
            Avg time to first contact
          </div>
          <div
            className="display font-bold"
            style={{ fontSize: 28, color: 'var(--success)', marginTop: 4 }}
          >
            {model.avgFirstContact != null ? `${model.avgFirstContact}m` : '—'}
          </div>
          <div className="text-ink-muted" style={{ fontSize: 10 }}>
            SLA: under 1 hour
          </div>
        </div>
        <div className="card-padded">
          <div
            className="text-ink-muted uppercase font-bold"
            style={{ fontSize: 10, letterSpacing: '0.05em' }}
          >
            FTA rate
          </div>
          <div
            className="display font-bold"
            style={{ fontSize: 28, color: 'var(--warning)', marginTop: 4 }}
          >
            {model.ftaRate === null ? '—' : `${model.ftaRate.toFixed(1)}%`}
          </div>
          <div className="text-ink-muted" style={{ fontSize: 10 }}>
            UK avg 8% · target under 5%
          </div>
        </div>
        <div className="card-padded">
          <div
            className="text-ink-muted uppercase font-bold"
            style={{ fontSize: 10, letterSpacing: '0.05em' }}
          >
            Pipeline value
          </div>
          <div
            className="display font-bold"
            style={{ fontSize: 28, color: 'var(--brand)', marginTop: 4 }}
          >
            {formatCurrency(model.pipelineValue)}
          </div>
          <div className="text-ink-muted" style={{ fontSize: 10 }}>
            Active leads
          </div>
        </div>
      </div>

      {/* Conversion funnel */}
      <div className="card-padded" style={{ marginBottom: 14 }}>
        <h2
          className="display font-bold"
          style={{ fontSize: 16, marginBottom: 14 }}
        >
          Conversion Funnel
        </h2>
        {model.funnel.map((stage, i) => {
          const pct = (stage.value / maxFunnel) * 100;
          const prev = i > 0 ? model.funnel[i - 1] : null;
          const drop = prev ? prev.value - stage.value : 0;
          const dropPct = prev && prev.value > 0 ? (drop / prev.value) * 100 : 0;
          return (
            <div key={stage.label} style={{ marginBottom: 10 }}>
              <div
                className="flex"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {stage.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: stage.colour,
                  }}
                >
                  {stage.value}
                  {prev && drop > 0 && (
                    <span
                      className="text-ink-muted"
                      style={{ fontSize: 11, fontWeight: 500 }}
                    >
                      {' '}
                      (-{drop}, -{dropPct.toFixed(0)}%)
                    </span>
                  )}
                </span>
              </div>
              <div
                style={{
                  height: 24,
                  background: 'var(--bg)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: stage.colour,
                    width: `${pct}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* By source + by practice */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 16, marginBottom: 12 }}
          >
            By source
          </h2>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thLeft}>Source</th>
                <th style={thRight}>Leads</th>
                <th style={thRight}>Conv</th>
                <th style={thRight}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {model.sourceBreakdown.map((s) => (
                <tr
                  key={s.name}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td style={{ padding: '8px 0' }}>{s.name}</td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 600,
                    }}
                  >
                    {s.leads}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      color: s.conversionRate > 15 ? 'var(--success)' : 'var(--ink)',
                    }}
                  >
                    {s.conversionRate.toFixed(0)}%
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--brand)',
                    }}
                  >
                    {formatCurrency(s.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 16, marginBottom: 12 }}
          >
            By practice
          </h2>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thLeft}>Practice</th>
                <th style={thRight}>Leads</th>
                <th style={thRight}>Conv</th>
              </tr>
            </thead>
            <tbody>
              {model.practiceBreakdown.map((p) => (
                <tr
                  key={p.name}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td style={{ padding: '8px 0', fontSize: 11 }}>{p.name}</td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 600,
                    }}
                  >
                    {p.leads}
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      color: p.conversionRate > 15 ? 'var(--success)' : 'var(--ink)',
                    }}
                  >
                    {p.conversionRate.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* By treatment — REAL invoiced fees from Dentally (invoice_items), grouped
          by treatment_name. Patients = unique invoiced patients per treatment. */}
      <div className="card-padded">
        <h2
          className="display font-bold"
          style={{ fontSize: 16, marginBottom: 4 }}
        >
          By treatment
        </h2>
        <p className="text-ink-muted" style={{ fontSize: 11, marginBottom: 12 }}>
          Invoiced fees from Dentally
        </p>
        {treatmentBreakdown.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 12 }}>
            No invoiced treatments yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {treatmentBreakdown.map((t) => (
              <div
                key={t.treatment_name}
                style={{
                  padding: 10,
                  background: 'var(--bg)',
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>{t.treatment_name}</div>
                <div
                  className="display font-bold"
                  style={{ fontSize: 20, color: 'var(--brand)', marginTop: 4 }}
                >
                  {formatCurrency(t.fee_pence)}
                </div>
                <div className="text-ink-muted" style={{ fontSize: 11 }}>
                  {t.patient_count} {t.patient_count === 1 ? 'patient' : 'patients'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Shared table-header cell styles (left/right aligned).
const thLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 0',
  fontSize: 10,
  color: 'var(--ink-muted)',
  textTransform: 'uppercase',
  fontWeight: 700,
};
const thRight: React.CSSProperties = { ...thLeft, textAlign: 'right' };
