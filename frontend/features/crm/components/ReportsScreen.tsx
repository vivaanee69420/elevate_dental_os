'use client';
// CRM Reports — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES['crm-reports'] at ~line 14996). Four headline KPIs, a
// conversion funnel with drop-off, by-source and by-practice tables, and a
// by-treatment value grid.
//
// Data flow:
//   LEADS -> status counts -> conversion / funnel
//         -> group by source  -> source ROI rows
//         -> group by practice-> practice rows
//         -> group by treatment-> treatment value cards

import { useMemo } from 'react';
import {
  LEADS,
  SOURCES,
  PRACTICES,
  TREATMENTS,
  formatCurrency,
} from '../data';

/** CRM Reports screen. */
export default function ReportsScreen() {
  const model = useMemo(() => {
    const totalLeads = LEADS.length;
    const contacted = LEADS.filter((l) => l.status !== 'new').length;
    const consultBooked = LEADS.filter((l) =>
      ['consultation_booked', 'consultation_attended', 'treatment_started'].includes(
        l.status,
      ),
    ).length;
    const consultAttended = LEADS.filter((l) =>
      ['consultation_attended', 'treatment_started'].includes(l.status),
    ).length;
    const treatmentStarted = LEADS.filter(
      (l) => l.status === 'treatment_started',
    ).length;

    const sourceBreakdown = SOURCES.map((s) => {
      const sl = LEADS.filter((l) => l.source === s);
      const converted = sl.filter(
        (l) => l.status === 'treatment_started',
      );
      return {
        name: s,
        leads: sl.length,
        conversionRate: sl.length ? (converted.length / sl.length) * 100 : 0,
        value: converted.reduce((sum, l) => sum + l.value, 0),
      };
    }).sort((a, b) => b.leads - a.leads);

    const practiceBreakdown = PRACTICES.map((p) => {
      const pl = LEADS.filter((l) => l.practice === p);
      const converted = pl.filter(
        (l) => l.status === 'treatment_started',
      ).length;
      return {
        name: p,
        leads: pl.length,
        conversionRate: pl.length ? (converted / pl.length) * 100 : 0,
      };
    }).sort((a, b) => b.leads - a.leads);

    const treatmentBreakdown = TREATMENTS.map((t) => {
      const tl = LEADS.filter((l) => l.treatment === t);
      return {
        name: t,
        leads: tl.length,
        value: tl.reduce((s, l) => s + l.value, 0),
      };
    })
      .filter((t) => t.leads > 0)
      .sort((a, b) => b.value - a.value);

    const funnel = [
      { label: 'Leads received', value: totalLeads, colour: '#3B82F6' },
      { label: 'Contacted', value: contacted, colour: '#7C3AED' },
      { label: 'Consultation booked', value: consultBooked, colour: '#6366F1' },
      { label: 'Consultation attended', value: consultAttended, colour: '#0891B2' },
      { label: 'Treatment started', value: treatmentStarted, colour: '#10B981' },
    ];

    const pipelineValue = LEADS.filter(
      (l) => l.status !== 'not_proceeding',
    ).reduce((s, l) => s + l.value, 0);

    return {
      totalLeads,
      treatmentStarted,
      sourceBreakdown,
      practiceBreakdown,
      treatmentBreakdown,
      funnel,
      pipelineValue,
    };
  }, []);

  const maxFunnel = model.totalLeads || 1;

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          CRM Reports
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Conversion funnel · source ROI · practice performance · response times
        </p>
      </div>

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
            style={{ fontSize: 28, color: '#10B981', marginTop: 4 }}
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
            style={{ fontSize: 28, color: '#10B981', marginTop: 4 }}
          >
            47m
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
            style={{ fontSize: 28, color: '#F59E0B', marginTop: 4 }}
          >
            4.2%
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
            style={{ fontSize: 28, color: '#0E7C7B', marginTop: 4 }}
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
                      color: s.conversionRate > 15 ? '#10B981' : 'var(--ink)',
                    }}
                  >
                    {s.conversionRate.toFixed(0)}%
                  </td>
                  <td
                    style={{
                      padding: '8px 0',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: '#0E7C7B',
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
                      color: p.conversionRate > 15 ? '#10B981' : 'var(--ink)',
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

      {/* By treatment */}
      <div className="card-padded">
        <h2
          className="display font-bold"
          style={{ fontSize: 16, marginBottom: 12 }}
        >
          By treatment
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {model.treatmentBreakdown.map((t) => (
            <div
              key={t.name}
              style={{
                padding: 10,
                background: 'var(--bg)',
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
              <div
                className="display font-bold"
                style={{ fontSize: 20, color: '#0E7C7B', marginTop: 4 }}
              >
                {formatCurrency(t.value)}
              </div>
              <div className="text-ink-muted" style={{ fontSize: 11 }}>
                {t.leads} enquiries
              </div>
            </div>
          ))}
        </div>
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
