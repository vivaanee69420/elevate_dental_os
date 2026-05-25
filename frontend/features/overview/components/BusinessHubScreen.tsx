'use client';
// Business Hub — pixel-faithful port of elevate-dental-os.html
// (PAGES['business-hub']). Multi-practice business hub for a dental group:
//
//   - ALL-SITES view: group KPI strip, one summary card per practice
//     (click to drill in), and a side-by-side comparison table.
//   - SINGLE-SITE view: breadcrumb back to all sites, seven sub-tabs
//     (Overview / Financials / Marketing / Operations / Team / Patients /
//     Compliance), each with its own KPI strip + cards/tables.
//
// The prototype drove selection and the active sub-tab through
// localStorage (window.bhSelect / window.bhSetSubTab + navigate()). Here
// that becomes plain React useState — `selected` (practice id or '') and
// `subTab`. No onclick strings, no localStorage, no backend.
//
// Money is WHOLE POUNDS (not pence) per this feature's convention;
// formatted via formatPounds / formatPoundsCompact. British English; emojis
// from the prototype have been stripped. Derived figures (expense split,
// channel split, funnel, etc.) mirror the prototype's arithmetic exactly.

import { useMemo, useState } from 'react';
import { Card, KpiTile, Chip, type ChipColour } from '@/components/ui';
import { formatPounds, formatPoundsCompact } from '@/features/_mock';

// Map the prototype's semantic badge tones to the shared Chip palette.
type Tone = 'success' | 'warning' | 'danger' | 'info';
const TONE_CHIP: Record<Tone, ChipColour> = {
  success: 'emerald',
  warning: 'amber',
  danger: 'rose',
  info: 'blue',
};

/** Semantic status pill rendered through the shared Chip primitive. */
function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Chip colour={TONE_CHIP[tone]}>{children}</Chip>;
}

// ---------------------------------------------------------------------------
// Mock dataset (trimmed inline copy of the prototype's BH_PRACTICES / BH_DATA).
// ---------------------------------------------------------------------------

interface Practice {
  id: string;
  name: string;
  colour: string;
  site: string;
}

interface Alert {
  p: 'urgent' | 'med' | 'low';
  t: string;
}

interface PracticeData {
  revenueMTD: number;
  revenueYTD: number;
  profit: number;
  margin: number;
  patientsActive: number;
  patientsNew: number;
  retentionRate: number;
  ltv: number;
  marketingSpend: number;
  leads: number;
  cpl: number;
  roas: number;
  consultations: number;
  treatmentStarts: number;
  chairUtil: number;
  noShowRate: number;
  udaProgress: number;
  recallCompliance: number;
  treatmentMix: { n: string; v: number }[];
  teamSize: number;
  clinicians: number;
  hygienists: number;
  nurses: number;
  reception: number;
  manager: number;
  complianceScore: number;
  dbsExpiringSoon: number;
  gdcExpiringSoon: number;
  indemnityExpiringSoon: number;
  alerts: Alert[];
  topClinician: string;
  keyMetricTrend: string;
}

const BH_PRACTICES: Practice[] = [
  { id: 'beechcroft', name: 'Beechcroft Lodge', colour: '#0E7C7B', site: 'Region 1 · High Street' },
  { id: 'edenford', name: 'Edenford Dental', colour: '#7C3AED', site: 'Region 2' },
  { id: 'belmont', name: 'Belmont Dental', colour: '#EC4899', site: 'Region 3' },
  { id: 'westfield', name: 'Westfield Dental', colour: '#F59E0B', site: 'Region 4' },
  { id: 'hartwell', name: 'Hartwell Smile Studio', colour: '#3B82F6', site: 'Region 5' },
];

const BH_DATA: Record<string, PracticeData> = {
  beechcroft: {
    revenueMTD: 180000, revenueYTD: 920000, profit: 39600, margin: 22,
    patientsActive: 3840, patientsNew: 142, retentionRate: 78, ltv: 2840,
    marketingSpend: 14400, leads: 248, cpl: 58, roas: 5.2, consultations: 84, treatmentStarts: 42,
    chairUtil: 78, noShowRate: 6.2, udaProgress: 74, recallCompliance: 88,
    treatmentMix: [{ n: 'Implants', v: 32 }, { n: 'Invisalign', v: 24 }, { n: 'Cosmetic', v: 18 }, { n: 'Hygiene', v: 14 }, { n: 'Routine', v: 12 }],
    teamSize: 18, clinicians: 6, hygienists: 3, nurses: 5, reception: 3, manager: 1,
    complianceScore: 96, dbsExpiringSoon: 0, gdcExpiringSoon: 1, indemnityExpiringSoon: 0,
    alerts: [
      { p: 'urgent', t: 'Chair 3 utilisation dropped 12% this week' },
      { p: 'med', t: 'Dr Smith GDC renewal due in 28 days' },
    ],
    topClinician: 'Dr Patel · £42k MTD',
    keyMetricTrend: '+18% YoY',
  },
  edenford: {
    revenueMTD: 140000, revenueYTD: 680000, profit: 25200, margin: 18,
    patientsActive: 2920, patientsNew: 98, retentionRate: 72, ltv: 2240,
    marketingSpend: 9800, leads: 172, cpl: 57, roas: 4.8, consultations: 62, treatmentStarts: 28,
    chairUtil: 68, noShowRate: 8.4, udaProgress: 62, recallCompliance: 82,
    treatmentMix: [{ n: 'Routine', v: 38 }, { n: 'Hygiene', v: 24 }, { n: 'Composite', v: 16 }, { n: 'Crown/Bridge', v: 12 }, { n: 'Implants', v: 10 }],
    teamSize: 14, clinicians: 4, hygienists: 2, nurses: 4, reception: 3, manager: 1,
    complianceScore: 91, dbsExpiringSoon: 1, gdcExpiringSoon: 0, indemnityExpiringSoon: 0,
    alerts: [
      { p: 'urgent', t: 'No-show rate above 8% target' },
      { p: 'med', t: 'Hygienist booking 2.4 weeks ahead — add capacity' },
    ],
    topClinician: 'Dr Chen · £28k MTD',
    keyMetricTrend: '+9% YoY',
  },
  belmont: {
    revenueMTD: 120000, revenueYTD: 580000, profit: 33600, margin: 28,
    patientsActive: 2280, patientsNew: 84, retentionRate: 81, ltv: 3120,
    marketingSpend: 7200, leads: 138, cpl: 52, roas: 5.8, consultations: 56, treatmentStarts: 34,
    chairUtil: 82, noShowRate: 5.1, udaProgress: 78, recallCompliance: 91,
    treatmentMix: [{ n: 'Cosmetic', v: 34 }, { n: 'Implants', v: 26 }, { n: 'Invisalign', v: 20 }, { n: 'Hygiene', v: 12 }, { n: 'Routine', v: 8 }],
    teamSize: 12, clinicians: 4, hygienists: 2, nurses: 3, reception: 2, manager: 1,
    complianceScore: 98, dbsExpiringSoon: 0, gdcExpiringSoon: 0, indemnityExpiringSoon: 0,
    alerts: [{ p: 'low', t: 'Highest margin practice — model for others' }],
    topClinician: 'Dr Brooks · £38k MTD',
    keyMetricTrend: '+24% YoY',
  },
  westfield: {
    revenueMTD: 95000, revenueYTD: 480000, profit: 20900, margin: 22,
    patientsActive: 2140, patientsNew: 72, retentionRate: 75, ltv: 2480,
    marketingSpend: 6800, leads: 124, cpl: 55, roas: 4.6, consultations: 48, treatmentStarts: 22,
    chairUtil: 71, noShowRate: 7.3, udaProgress: 68, recallCompliance: 85,
    treatmentMix: [{ n: 'Routine', v: 32 }, { n: 'Hygiene', v: 22 }, { n: 'Crown/Bridge', v: 18 }, { n: 'Implants', v: 16 }, { n: 'Cosmetic', v: 12 }],
    teamSize: 11, clinicians: 3, hygienists: 2, nurses: 3, reception: 2, manager: 1,
    complianceScore: 93, dbsExpiringSoon: 0, gdcExpiringSoon: 2, indemnityExpiringSoon: 1,
    alerts: [
      { p: 'urgent', t: '2 clinicians have GDC renewals within 30 days' },
      { p: 'med', t: 'Recall compliance below 90% target' },
    ],
    topClinician: 'Dr Khan · £22k MTD',
    keyMetricTrend: '+12% YoY',
  },
  hartwell: {
    revenueMTD: 75000, revenueYTD: 380000, profit: 18000, margin: 24,
    patientsActive: 1480, patientsNew: 54, retentionRate: 84, ltv: 4280,
    marketingSpend: 5400, leads: 86, cpl: 63, roas: 6.1, consultations: 38, treatmentStarts: 24,
    chairUtil: 85, noShowRate: 4.2, udaProgress: 0, recallCompliance: 94,
    treatmentMix: [{ n: 'Implants', v: 62 }, { n: 'Full Arch', v: 18 }, { n: 'Cosmetic', v: 12 }, { n: 'Sedation', v: 5 }, { n: 'Hygiene', v: 3 }],
    teamSize: 9, clinicians: 3, hygienists: 1, nurses: 3, reception: 1, manager: 1,
    complianceScore: 97, dbsExpiringSoon: 0, gdcExpiringSoon: 0, indemnityExpiringSoon: 0,
    alerts: [
      { p: 'low', t: 'Highest patient LTV — implant focus paying off' },
      { p: 'med', t: 'New patient volume below target — increase ad spend' },
    ],
    topClinician: 'Dr Mehta · £42k MTD',
    keyMetricTrend: '+28% YoY',
  },
};

const SUB_TABS = [
  { k: 'overview', l: 'Overview' },
  { k: 'financials', l: 'Financials' },
  { k: 'marketing', l: 'Marketing' },
  { k: 'operations', l: 'Operations' },
  { k: 'team', l: 'Team' },
  { k: 'patients', l: 'Patients' },
  { k: 'compliance', l: 'Compliance' },
] as const;

type SubTabKey = (typeof SUB_TABS)[number]['k'];

// --- shared helpers ---------------------------------------------------------

/** Colour a utilisation %: green >=80, amber >=70, red below. */
const utilColour = (v: number) => (v >= 80 ? 'var(--success)' : v >= 70 ? 'var(--warning)' : 'var(--danger)');
/** Colour a no-show %: green <=5, amber <=7, red above. */
const noShowColour = (v: number) => (v <= 5 ? 'var(--success)' : v <= 7 ? 'var(--warning)' : 'var(--danger)');
/** Colour a compliance %: green >=95, amber below. */
const complianceColour = (v: number) => (v >= 95 ? 'var(--success)' : 'var(--warning)');
/** Colour a ROAS: green >=4, amber >=3, red below. */
const roasColour = (v: number) => (v >= 4 ? 'var(--success)' : v >= 3 ? 'var(--warning)' : 'var(--danger)');

/** Section card title row, mirrors the prototype's mCard header. */
function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center" style={{ marginBottom: 14 }}>
      <h2 className="display font-semibold" style={{ fontSize: 16 }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

/** A labelled value row on a tinted background (prototype's snapshot rows). */
function StatRow({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div
      className="flex justify-between"
      style={{ padding: 10, background: '#F8FAFC', borderRadius: 7, fontSize: 13 }}
    >
      <span>{label}</span>
      <b style={colour ? { color: colour } : undefined}>{value}</b>
    </div>
  );
}

/** A labelled horizontal bar (treatment mix / demographics / funnel). */
function Bar({
  label,
  rightLabel,
  pct,
  colour,
  height = 8,
}: {
  label: string;
  rightLabel: string;
  pct: number;
  colour: string;
  height?: number;
}) {
  return (
    <div>
      <div
        className="flex justify-between"
        style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}
      >
        <span>{label}</span>
        <span>{rightLabel}</span>
      </div>
      <div style={{ background: '#F1F5F9', height, borderRadius: height / 2, overflow: 'hidden' }}>
        <div style={{ background: colour, height, width: `${Math.min(pct, 100)}%`, borderRadius: height / 2 }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ALL-SITES VIEW
// ---------------------------------------------------------------------------

function AllSitesView({ onSelect }: { onSelect: (id: string) => void }) {
  const totals = useMemo(
    () =>
      Object.values(BH_DATA).reduce(
        (acc, d) => ({
          revenueMTD: acc.revenueMTD + d.revenueMTD,
          profit: acc.profit + d.profit,
          patients: acc.patients + d.patientsActive,
          leads: acc.leads + d.leads,
          alerts: acc.alerts + d.alerts.filter((a) => a.p === 'urgent').length,
          teamSize: acc.teamSize + d.teamSize,
        }),
        { revenueMTD: 0, profit: 0, patients: 0, leads: 0, alerts: 0, teamSize: 0 },
      ),
    [],
  );

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="display text-3xl font-bold">Business Hub</h1>
          <p className="text-sm text-ink-muted mt-1">
            Per-site deep-dive across all 5 practices &middot; click any card for full drill-down &middot;
            compare side-by-side
          </p>
        </div>
      </div>

      {/* Group KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
        <KpiTile label="Active Sites" value={String(BH_PRACTICES.length)} delta="across the group" />
        <KpiTile label="Group Revenue MTD" value={formatPounds(totals.revenueMTD)} delta="+14% vs last month" deltaTone="up" />
        <KpiTile
          label="Group Profit"
          value={formatPounds(totals.profit)}
          delta={`${((totals.profit / totals.revenueMTD) * 100).toFixed(1)}% margin`}
        />
        <KpiTile label="Active Patients" value={totals.patients.toLocaleString('en-GB')} delta="total base" />
        <KpiTile label="New Leads MTD" value={String(totals.leads)} delta="across all sites" />
        <KpiTile label="Urgent Alerts" value={String(totals.alerts)} delta="needs attention" deltaTone={totals.alerts > 0 ? 'down' : 'muted'} />
      </div>

      {/* Practice summary cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
        {BH_PRACTICES.map((p) => {
          const d = BH_DATA[p.id];
          const urgentCount = d.alerts.filter((a) => a.p === 'urgent').length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className="text-left"
              style={{
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${p.colour}`,
                borderRadius: 12,
                padding: 18,
                cursor: 'pointer',
              }}
            >
              <div className="flex justify-between items-start" style={{ marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)', letterSpacing: '-.01em' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted, #64748B)', marginTop: 2 }}>{p.site}</div>
                </div>
                <div className="flex items-center" style={{ gap: 6 }}>
                  {urgentCount > 0 && (
                    <span
                      style={{
                        background: '#FEE2E2',
                        color: '#991B1B',
                        padding: '3px 9px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {urgentCount} urgent
                    </span>
                  )}
                  <span
                    style={{
                      background: `${p.colour}22`,
                      color: p.colour,
                      padding: '3px 9px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {d.keyMetricTrend}
                  </span>
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                {[
                  { l: 'Revenue MTD', v: formatPoundsCompact(d.revenueMTD), c: 'var(--ink)' },
                  { l: 'Margin', v: `${d.margin}%`, c: 'var(--ink)' },
                  { l: 'Chair Util', v: `${d.chairUtil}%`, c: utilColour(d.chairUtil) },
                  { l: 'ROAS', v: `${d.roas}×`, c: 'var(--ink)' },
                ].map((m) => (
                  <div key={m.l}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--ink-muted, #64748B)',
                        letterSpacing: '.04em',
                      }}
                    >
                      {m.l}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: m.c, letterSpacing: '-.01em', marginTop: 2 }}>
                      {m.v}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="flex justify-between"
                style={{ padding: 10, background: '#F8FAFC', borderRadius: 8, fontSize: 12, color: '#475569' }}
              >
                <span>
                  {d.patientsActive.toLocaleString('en-GB')} patients &middot; {d.teamSize} team
                </span>
                <span style={{ color: 'var(--brand)', fontWeight: 600 }}>View detail &rarr;</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Side-by-side comparison */}
      <Card>
        <CardTitle>Side-by-Side Comparison</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Site</th>
              <th className="right">Revenue MTD</th>
              <th className="right">Profit</th>
              <th className="right">Margin</th>
              <th className="right">Patients</th>
              <th className="right">New</th>
              <th className="right">CPL</th>
              <th className="right">ROAS</th>
              <th className="right">Chair Util</th>
              <th className="right">No-show</th>
              <th className="right">Compliance</th>
              <th className="right">Team</th>
            </tr>
          </thead>
          <tbody>
            {BH_PRACTICES.map((p) => {
              const d = BH_DATA[p.id];
              return (
                <tr key={p.id}>
                  <td>
                    <b style={{ color: p.colour }}>{p.name}</b>
                  </td>
                  <td className="right">{formatPounds(d.revenueMTD)}</td>
                  <td className="right">{formatPounds(d.profit)}</td>
                  <td className="right">{d.margin}%</td>
                  <td className="right">{d.patientsActive.toLocaleString('en-GB')}</td>
                  <td className="right">{d.patientsNew}</td>
                  <td className="right">{formatPounds(d.cpl)}</td>
                  <td className="right">{d.roas}&times;</td>
                  <td className="right" style={{ color: utilColour(d.chairUtil), fontWeight: 700 }}>
                    {d.chairUtil}%
                  </td>
                  <td className="right" style={{ color: noShowColour(d.noShowRate), fontWeight: 700 }}>
                    {d.noShowRate}%
                  </td>
                  <td className="right" style={{ color: complianceColour(d.complianceScore), fontWeight: 700 }}>
                    {d.complianceScore}%
                  </td>
                  <td className="right">{d.teamSize}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SINGLE-SITE VIEW
// ---------------------------------------------------------------------------

function OverviewPanel({ p, d }: { p: Practice; d: PracticeData }) {
  const alertStyles: Record<Alert['p'], { bg: string; fg: string; label: string }> = {
    urgent: { bg: '#FEE2E2', fg: '#991B1B', label: 'Urgent' },
    med: { bg: '#FEF3C7', fg: '#92400E', label: 'Action' },
    low: { bg: '#ECFDF5', fg: '#065F46', label: 'Note' },
  };

  return (
    <>
      {d.alerts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {d.alerts.map((a, i) => {
            const c = alertStyles[a.p];
            return (
              <div
                key={i}
                style={{
                  background: c.bg,
                  color: c.fg,
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 700, marginRight: 8 }}>{c.label}:</span>
                {a.t}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
        <KpiTile label="Revenue MTD" value={formatPounds(d.revenueMTD)} delta={`${d.keyMetricTrend} · YTD ${formatPoundsCompact(d.revenueYTD)}`} deltaTone="up" />
        <KpiTile label="Profit MTD" value={formatPounds(d.profit)} delta={`${d.margin}% margin`} />
        <KpiTile label="Active Patients" value={d.patientsActive.toLocaleString('en-GB')} delta={`+${d.patientsNew} new this month`} deltaTone="up" />
        <KpiTile label="Leads MTD" value={String(d.leads)} delta={`CPL ${formatPounds(d.cpl)}`} />
        <KpiTile label="Chair Util" value={`${d.chairUtil}%`} delta={d.chairUtil >= 80 ? 'optimal' : d.chairUtil >= 70 ? 'OK' : 'low'} />
        <KpiTile label="Compliance" value={`${d.complianceScore}%`} delta="across all checks" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <CardTitle>Daily Performance Snapshot</CardTitle>
          <div className="flex flex-col" style={{ gap: 8 }}>
            <StatRow label="Top Performer" value={d.topClinician} colour="var(--success)" />
            <StatRow label="New Patients Today" value="12 (avg 8)" colour="var(--success)" />
            <StatRow label="Treatment Plans Sent" value="8 today" colour="#3B82F6" />
            <StatRow label="No-Shows Today" value="2 of 86 booked" colour={d.noShowRate < 6 ? 'var(--success)' : 'var(--warning)'} />
            <StatRow label="Recall Compliance" value={`${d.recallCompliance}%`} colour={d.recallCompliance >= 90 ? 'var(--success)' : 'var(--warning)'} />
          </div>
        </Card>
        <Card>
          <CardTitle>Treatment Mix &middot; MTD</CardTitle>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {d.treatmentMix.map((t) => (
              <Bar key={t.n} label={t.n} rightLabel={`${t.v}%`} pct={t.v * 2} colour={p.colour} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function FinancialsPanel({ p, d }: { p: Practice; d: PracticeData }) {
  const expenses: [string, number, number][] = [
    ['Salaries & Wages', Math.round(d.revenueMTD * 0.38), 38],
    ['Lab Fees', Math.round(d.revenueMTD * 0.12), 12],
    ['Materials & Stock', Math.round(d.revenueMTD * 0.08), 8],
    ['Marketing', d.marketingSpend, Math.round((d.marketingSpend / d.revenueMTD) * 100)],
    ['Rent & Utilities', Math.round(d.revenueMTD * 0.06), 6],
    ['Software & Subs', Math.round(d.revenueMTD * 0.02), 2],
    ['Insurance & Indemnity', Math.round(d.revenueMTD * 0.015), 1.5],
    ['Other', Math.round(d.revenueMTD * 0.04), 4],
  ];
  const totalExp = expenses.reduce((s, e) => s + e[1], 0);
  const months = [0.82, 0.88, 0.91, 0.95, 0.97, 1.0];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Revenue MTD" value={formatPounds(d.revenueMTD)} delta="gross" />
        <KpiTile label="Total Expenses" value={formatPounds(totalExp)} delta="all categories" />
        <KpiTile label="Net Profit" value={formatPounds(d.revenueMTD - totalExp)} delta={`${d.margin}% margin`} />
        <KpiTile label="Cash on Hand" value={formatPounds(Math.round(d.revenueMTD * 0.4))} delta="reserves" />
      </div>

      <Card className="mb-4">
        <CardTitle>Expense Breakdown &middot; MTD</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th className="right">Amount</th>
              <th className="right">% of Revenue</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(([l, v, pct], i) => (
              <tr key={l}>
                <td>
                  <b>{l}</b>
                </td>
                <td className="right">{formatPounds(v)}</td>
                <td className="right">{pct}%</td>
                <td>
                  {i % 2 === 0 ? (
                    <span style={{ color: 'var(--success)' }}>&darr; -2%</span>
                  ) : (
                    <span style={{ color: 'var(--warning)' }}>&uarr; +3%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Revenue Trend &middot; Last 6 Months</CardTitle>
        <div
          className="flex items-end justify-around"
          style={{ height: 160, padding: 14, background: '#F8FAFC', borderRadius: 10 }}
        >
          {months.map((mult, i) => {
            const month = new Date();
            month.setMonth(month.getMonth() - (5 - i));
            return (
              <div key={i} className="flex flex-col items-center" style={{ gap: 6, flex: 1 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#475569' }}>
                  {formatPoundsCompact(d.revenueMTD * mult)}
                </div>
                <div
                  style={{
                    width: 32,
                    height: `${mult * 100}%`,
                    background: `linear-gradient(180deg, ${p.colour}AA, ${p.colour})`,
                    borderRadius: '6px 6px 0 0',
                  }}
                />
                <div style={{ fontSize: 10.5, color: '#94A3B8', fontWeight: 600 }}>
                  {month.toLocaleDateString('en-GB', { month: 'short' })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function MarketingPanel({ d }: { d: PracticeData }) {
  const channels = [
    { n: 'Meta Ads', spend: Math.round(d.marketingSpend * 0.45), leads: Math.round(d.leads * 0.42), cpl: 55, roas: 5.4, c: '#1877F2' },
    { n: 'Google Ads', spend: Math.round(d.marketingSpend * 0.35), leads: Math.round(d.leads * 0.32), cpl: 62, roas: 4.8, c: '#4285F4' },
    { n: 'Organic SEO', spend: 0, leads: Math.round(d.leads * 0.14), cpl: 0, roas: 99, c: '#10B981' },
    { n: 'Referrals', spend: 0, leads: Math.round(d.leads * 0.1), cpl: 0, roas: 99, c: '#8B5CF6' },
    { n: 'Other', spend: Math.round(d.marketingSpend * 0.2), leads: Math.round(d.leads * 0.02), cpl: 140, roas: 2.1, c: '#94A3B8' },
  ];
  const funnel: [string, number, number, string][] = [
    ['Leads', d.leads, 100, 'var(--brand)'],
    ['Consultations', d.consultations, Math.round((d.consultations / d.leads) * 100), '#10B981'],
    ['Treatment Plans Sent', Math.round(d.consultations * 0.78), Math.round(((d.consultations * 0.78) / d.leads) * 100), '#3B82F6'],
    ['Treatment Started', d.treatmentStarts, Math.round((d.treatmentStarts / d.leads) * 100), '#8B5CF6'],
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Spend MTD" value={formatPounds(d.marketingSpend)} delta={`${Math.round((d.marketingSpend / d.revenueMTD) * 100)}% of revenue`} />
        <KpiTile label="Leads MTD" value={String(d.leads)} delta="all channels" />
        <KpiTile label="Avg CPL" value={formatPounds(d.cpl)} delta="industry: £75" />
        <KpiTile label="Blended ROAS" value={`${d.roas}×`} delta="target: 4×" />
      </div>

      <Card className="mb-4">
        <CardTitle>Channel Performance &middot; MTD</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Channel</th>
              <th className="right">Spend</th>
              <th className="right">Leads</th>
              <th className="right">CPL</th>
              <th className="right">ROAS</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.n}>
                <td>
                  <span className="inline-flex items-center" style={{ gap: 6 }}>
                    <span style={{ width: 10, height: 10, background: ch.c, borderRadius: 2 }} />
                    <b>{ch.n}</b>
                  </span>
                </td>
                <td className="right">{formatPounds(ch.spend)}</td>
                <td className="right">{ch.leads}</td>
                <td className="right">
                  {ch.cpl > 0 ? formatPounds(ch.cpl) : <span style={{ color: 'var(--success)', fontWeight: 700 }}>£0</span>}
                </td>
                <td className="right">
                  {ch.roas === 99 ? (
                    <span style={{ color: 'var(--success)', fontWeight: 700 }}>&infin;</span>
                  ) : (
                    <b style={{ color: roasColour(ch.roas) }}>{ch.roas}&times;</b>
                  )}
                </td>
                <td>
                  {ch.roas >= 4 ? (
                    <StatusChip tone="success">Strong</StatusChip>
                  ) : ch.roas >= 3 ? (
                    <StatusChip tone="warning">OK</StatusChip>
                  ) : (
                    <StatusChip tone="danger">Underperforming</StatusChip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Acquisition Funnel &middot; MTD</CardTitle>
        <div className="flex flex-col" style={{ gap: 10 }}>
          {funnel.map(([l, v, pct, c]) => (
            <Bar key={l} label={l} rightLabel={`${v} (${pct}%)`} pct={pct} colour={c} height={12} />
          ))}
        </div>
      </Card>
    </>
  );
}

function OperationsPanel({ p, d }: { p: Practice; d: PracticeData }) {
  // Deterministic per-surgery utilisation (no Math.random — stable render).
  const surgeryCount = Math.ceil(d.teamSize / 4);
  const surgeries = Array.from({ length: surgeryCount }, (_, i) => ({
    n: i + 1,
    util: 64 + ((i * 7 + d.chairUtil) % 30),
  }));
  const leadTimes: [string, string, string][] = [
    ['Routine Check-up', '2 weeks', 'var(--success)'],
    ['Hygienist', '3 weeks', 'var(--warning)'],
    ['Consultation (Implant)', '1 week', 'var(--success)'],
    ['Cosmetic Consult', '5 days', 'var(--success)'],
    ['Emergency', 'Same day', 'var(--success)'],
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Chair Utilisation" value={`${d.chairUtil}%`} delta="target: 85%" />
        <KpiTile label="No-show Rate" value={`${d.noShowRate}%`} delta="target: <5%" />
        <KpiTile label="UDA Progress" value={d.udaProgress > 0 ? `${d.udaProgress}%` : 'N/A'} delta={d.udaProgress > 0 ? 'NHS contract' : 'private only'} />
        <KpiTile label="Recall Compliance" value={`${d.recallCompliance}%`} delta="target: 90%" />
      </div>

      <Card className="mb-4">
        <CardTitle>Treatment Mix &middot; Revenue Distribution</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Treatment</th>
              <th className="right">% of Revenue</th>
              <th className="right">Est. £/month</th>
              <th>Visual</th>
            </tr>
          </thead>
          <tbody>
            {d.treatmentMix.map((t) => (
              <tr key={t.n}>
                <td>
                  <b>{t.n}</b>
                </td>
                <td className="right">{t.v}%</td>
                <td className="right">{formatPounds(Math.round((d.revenueMTD * t.v) / 100))}</td>
                <td>
                  <div style={{ background: '#F1F5F9', height: 8, borderRadius: 4, width: 120, overflow: 'hidden' }}>
                    <div style={{ background: p.colour, height: 8, width: `${Math.min(t.v * 2, 100)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <CardTitle>Chair Activity &middot; By Surgery</CardTitle>
          <div className="flex flex-col" style={{ gap: 8, fontSize: 13 }}>
            {surgeries.map((s) => (
              <div
                key={s.n}
                className="flex justify-between items-center"
                style={{ padding: 10, background: '#F8FAFC', borderRadius: 7 }}
              >
                <span>Surgery {s.n}</span>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <div style={{ background: '#E5E7EB', height: 8, width: 100, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ background: utilColour(s.util), height: 8, width: `${s.util}%` }} />
                  </div>
                  <b style={{ color: utilColour(s.util), minWidth: 36, textAlign: 'right' }}>{s.util}%</b>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Booking Lead Times</CardTitle>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {leadTimes.map(([l, v, c]) => (
              <StatRow key={l} label={l} value={v} colour={c} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function TeamPanel({ d }: { d: PracticeData }) {
  const breakdown: [string, number, string][] = [
    ['Clinicians', d.clinicians, '#0E7C7B'],
    ['Hygienists', d.hygienists, '#10B981'],
    ['Nurses', d.nurses, '#3B82F6'],
    ['Reception', d.reception, '#8B5CF6'],
    ['Manager', d.manager, '#F59E0B'],
  ];
  const workforce: [string, string, string][] = [
    ['Annual leave booked next month', '3 staff', 'var(--warning)'],
    ['Sick days MTD', '4 days', 'var(--success)'],
    ['Training hours due (CPD)', '12 hours pending', '#3B82F6'],
    ['Open vacancies', d.teamSize < 14 ? '1 (Hygienist)' : 'None', d.teamSize < 14 ? 'var(--warning)' : 'var(--success)'],
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 18 }}>
        {breakdown.map(([l, v, c]) => (
          <div
            key={l}
            style={{
              background: 'var(--bg-card, #fff)',
              border: '1px solid var(--border)',
              borderLeft: `4px solid ${c}`,
              borderRadius: 10,
              padding: 14,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.02em' }}>{v}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted, #64748B)', fontWeight: 600, marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <CardTitle>Team Performance &middot; MTD</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Role</th>
              <th className="right">Headcount</th>
              <th className="right">Avg Revenue / Person</th>
              <th>Top Performer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>Clinicians</b></td>
              <td className="right">{d.clinicians}</td>
              <td className="right">{formatPounds(Math.round((d.revenueMTD * 0.75) / d.clinicians))}</td>
              <td>{d.topClinician}</td>
              <td><StatusChip tone="success">Performing</StatusChip></td>
            </tr>
            <tr>
              <td><b>Hygienists</b></td>
              <td className="right">{d.hygienists}</td>
              <td className="right">{formatPounds(Math.round((d.revenueMTD * 0.12) / d.hygienists))}</td>
              <td>Sarah B &middot; £8k MTD</td>
              <td><StatusChip tone="success">Performing</StatusChip></td>
            </tr>
            <tr>
              <td><b>Nurses</b></td>
              <td className="right">{d.nurses}</td>
              <td className="right">N/A</td>
              <td>Lead nurse: Maria T</td>
              <td><StatusChip tone="info">Stable</StatusChip></td>
            </tr>
            <tr>
              <td><b>Reception</b></td>
              <td className="right">{d.reception}</td>
              <td className="right">N/A</td>
              <td>Call answer rate: 96%</td>
              <td><StatusChip tone="success">Strong</StatusChip></td>
            </tr>
            <tr>
              <td><b>Practice Manager</b></td>
              <td className="right">{d.manager}</td>
              <td className="right">N/A</td>
              <td>&mdash;</td>
              <td><StatusChip tone="info">Active</StatusChip></td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Workforce Alerts</CardTitle>
        <div className="flex flex-col" style={{ gap: 10 }}>
          {workforce.map(([l, v, c]) => (
            <StatRow key={l} label={l} value={v} colour={c} />
          ))}
        </div>
      </Card>
    </>
  );
}

function PatientsPanel({ d }: { d: PracticeData }) {
  const sources: [string, number, string, number, string, 'success' | 'info' | 'warning'][] = [
    ['Referral (Word of Mouth)', Math.round(d.patientsNew * 0.32), '32%', Math.round(d.ltv * 1.3), 'Highest LTV', 'success'],
    ['Google Search', Math.round(d.patientsNew * 0.28), '28%', Math.round(d.ltv * 1.1), 'Strong', 'success'],
    ['Social Media', Math.round(d.patientsNew * 0.22), '22%', Math.round(d.ltv * 0.85), 'OK', 'info'],
    ['Local Listing', Math.round(d.patientsNew * 0.12), '12%', Math.round(d.ltv * 0.9), 'Stable', 'info'],
    ['Other', Math.round(d.patientsNew * 0.06), '6%', Math.round(d.ltv * 0.7), 'Low', 'warning'],
  ];
  const demographics: [string, string, string][] = [
    ['Age 0-17', '18%', '#3B82F6'],
    ['Age 18-34', '24%', '#10B981'],
    ['Age 35-54', '38%', '#F59E0B'],
    ['Age 55+', '20%', '#8B5CF6'],
  ];
  const recall: [string, string, string][] = [
    ['Due for recall', '142 patients', 'var(--warning)'],
    ['Recalls completed MTD', '98', 'var(--success)'],
    ['Lapsed >12 months', '184 patients', 'var(--danger)'],
    ['Reactivated MTD', '12', 'var(--success)'],
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Active Patients" value={d.patientsActive.toLocaleString('en-GB')} delta="last 12 months" />
        <KpiTile label="New This Month" value={String(d.patientsNew)} delta="first-time visits" />
        <KpiTile label="Retention Rate" value={`${d.retentionRate}%`} delta="rebooked" />
        <KpiTile label="Patient LTV" value={formatPounds(d.ltv)} delta="lifetime value" />
      </div>

      <Card className="mb-4">
        <CardTitle>Patient Source &middot; MTD</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Source</th>
              <th className="right">New Patients</th>
              <th className="right">% of New</th>
              <th className="right">LTV Avg</th>
              <th>Best Channel</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(([l, n, pct, ltv, badge, tone]) => (
              <tr key={l}>
                <td>{l}</td>
                <td className="right">{n}</td>
                <td className="right">{pct}</td>
                <td className="right">{formatPounds(ltv)}</td>
                <td><StatusChip tone={tone}>{badge}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <CardTitle>Patient Demographics</CardTitle>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {demographics.map(([l, v, c]) => (
              <Bar key={l} label={l} rightLabel={v} pct={parseInt(v, 10) * 2.5} colour={c} />
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Recall &amp; Reactivation</CardTitle>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {recall.map(([l, v, c]) => (
              <StatRow key={l} label={l} value={v} colour={c} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function CompliancePanel({ d }: { d: PracticeData }) {
  const items = [
    { n: 'DBS Checks', expiring: d.dbsExpiringSoon, total: d.teamSize, c: '#3B82F6' },
    { n: 'GDC Registration', expiring: d.gdcExpiringSoon, total: d.clinicians + d.hygienists, c: '#10B981' },
    { n: 'Professional Indemnity', expiring: d.indemnityExpiringSoon, total: d.clinicians, c: '#8B5CF6' },
    { n: 'CPD Hours Tracking', expiring: 0, total: d.clinicians + d.hygienists, c: '#F59E0B' },
    { n: 'First Aid Training', expiring: 1, total: d.teamSize, c: '#EF4444' },
    { n: 'Fire Safety', expiring: 0, total: 1, c: '#F59E0B' },
    { n: 'COSHH Assessment', expiring: 0, total: 1, c: '#06B6D4' },
    { n: 'Infection Control Audit', expiring: 0, total: 1, c: '#10B981' },
  ];
  const calendar: [string, string, string][] = [
    ['Annual CQC Self-Assessment', 'Due in 18 days', 'var(--warning)'],
    ['Fire Safety Drill', 'Due in 32 days', 'var(--success)'],
    ['Infection Control Audit', 'Completed (next: 6 months)', 'var(--success)'],
    ['Patient Survey', 'Quarterly · due in 12 days', '#3B82F6'],
    ['Insurance Renewal', 'Due in 64 days', 'var(--success)'],
  ];
  const expiringSoon = d.dbsExpiringSoon + d.gdcExpiringSoon + d.indemnityExpiringSoon;
  const openActions = items.reduce((s, i) => s + i.expiring, 0);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiTile label="Compliance Score" value={`${d.complianceScore}%`} delta="overall" />
        <KpiTile label="Expiring Soon" value={String(expiringSoon)} delta="within 30 days" />
        <KpiTile label="CQC Status" value="Good" delta="last inspection" />
        <KpiTile label="Open Actions" value={String(openActions)} delta="need attention" />
      </div>

      <Card className="mb-4">
        <CardTitle>Compliance Items</CardTitle>
        <table className="table" style={{ margin: -16, marginTop: 0 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th className="right">Coverage</th>
              <th className="right">Expiring Soon</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.n}>
                <td>
                  <span className="inline-flex items-center" style={{ gap: 6 }}>
                    <span style={{ width: 10, height: 10, background: it.c, borderRadius: 2 }} />
                    <b>{it.n}</b>
                  </span>
                </td>
                <td className="right">{it.total} staff</td>
                <td className="right">
                  {it.expiring > 0 ? (
                    <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{it.expiring}</span>
                  ) : (
                    <span style={{ color: 'var(--success)' }}>0</span>
                  )}
                </td>
                <td>
                  {it.expiring === 0 ? (
                    <StatusChip tone="success">Compliant</StatusChip>
                  ) : (
                    <StatusChip tone="warning">Action needed</StatusChip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Upcoming Compliance Calendar</CardTitle>
        <div className="flex flex-col" style={{ gap: 8 }}>
          {calendar.map(([l, v, c]) => (
            <StatRow key={l} label={l} value={v} colour={c} />
          ))}
        </div>
      </Card>
    </>
  );
}

function SingleSiteView({
  practice,
  subTab,
  onBack,
  onSubTab,
}: {
  practice: Practice;
  subTab: SubTabKey;
  onBack: () => void;
  onSubTab: (k: SubTabKey) => void;
}) {
  const d = BH_DATA[practice.id];

  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="display text-3xl font-bold">{practice.name} &middot; Business Detail</h1>
          <p className="text-sm text-ink-muted mt-1">{practice.site} &middot; all KPIs and trackers for this site</p>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'var(--bg-card, #fff)',
            border: '1px solid var(--border)',
            color: '#475569',
            padding: '8px 14px',
            borderRadius: 7,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          &larr; All Sites
        </button>
        <span style={{ fontSize: 13, color: 'var(--ink-muted, #64748B)' }}>&rsaquo;</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: practice.colour }}>{practice.name}</span>
        <span style={{ fontSize: 11.5, color: '#94A3B8', marginLeft: 'auto' }}>{practice.site}</span>
      </div>

      {/* Sub-tabs */}
      <div className="flex" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {SUB_TABS.map((t) => {
          const active = t.k === subTab;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => onSubTab(t.k)}
              style={{
                background: active ? 'var(--brand)' : 'var(--bg-card, #fff)',
                color: active ? '#fff' : '#475569',
                border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                padding: '8px 14px',
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.l}
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      {subTab === 'overview' && <OverviewPanel p={practice} d={d} />}
      {subTab === 'financials' && <FinancialsPanel p={practice} d={d} />}
      {subTab === 'marketing' && <MarketingPanel d={d} />}
      {subTab === 'operations' && <OperationsPanel p={practice} d={d} />}
      {subTab === 'team' && <TeamPanel d={d} />}
      {subTab === 'patients' && <PatientsPanel d={d} />}
      {subTab === 'compliance' && <CompliancePanel d={d} />}
    </div>
  );
}

/** Business Hub page: all-sites overview, drill into one site via sub-tabs. */
export default function BusinessHubScreen() {
  const [selected, setSelected] = useState<string>('');
  const [subTab, setSubTab] = useState<SubTabKey>('overview');

  const practice = BH_PRACTICES.find((p) => p.id === selected);

  if (!selected || !practice) {
    return (
      <AllSitesView
        onSelect={(id) => {
          setSelected(id);
          setSubTab('overview');
        }}
      />
    );
  }

  return (
    <SingleSiteView
      practice={practice}
      subTab={subTab}
      onBack={() => setSelected('')}
      onSubTab={setSubTab}
    />
  );
}
