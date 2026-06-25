'use client';

// Group Performance — Intelligence-OS group blocks for the Business Hub:
// headline funnel KPIs, marketing snapshot, per-entity performance table,
// revenue-by-line, profit-contribution, and a decision lens.
//
// Wired to live data only. Real feeds today: Dentally (turnover, appts,
// no-show, leads, conversion via /api/analytics/business-hub) and the ad
// platforms — real Google Ads + Meta spend/leads/ROAS via the scope/period-aware
// /api/analytics/marketing-roi (ad_metrics + CRM lead attribution). The marketing
// snapshot reacts to the global Scope/Period bar AND a dynamic per-provider
// ad-account filter directly above it. Anything with no source yet — treatment-
// value closed, cash collected, per-entity profit/margin/ROAS, revenue/profit by
// treatment line — renders zero or an empty state. Those fill in once Xero (P&L)
// and a treatment-production/price feed are connected.

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Gem, TrendingDown } from 'lucide-react';
import { Card, Chip, AlertRow, EmptyState, SkeletonKpiRow, SkeletonChart, type ChipColour } from '@/components/ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useBusinessHub, usePlanFeesLines, type HubPractice, type RevenueLine, type PlanFeeLine } from '../business-hub-api';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { SectionFilterPills } from '@/features/_shared/SectionFilterPills';
import { DecisionLens } from '@/features/_shared/DecisionLens';
import { usePractices } from '@/features/practices/hooks';
import { useMarketingRoi } from '@/features/intelligence/marketing-roi-hooks';
import type { MarketingRoi } from '@/features/intelligence/marketing-roi-api';
import { AdAccountFilter } from '@/features/intelligence/AdAccountFilter';
import { getQuickBooksOverview } from '@/features/finance/quickbooks-api';
import { useGhlDashboard } from '@/features/ghl/hooks';
import { QuickBooksGroupSection } from './QuickBooksGroupSection';
import { GhlSummaryCards } from '@/features/ghl/components/GhlSummaryCards';

const DASH = '—';

type HeadlineKpi = {
  label: string; value: string; sub: string; chip: { text: string; tone: ChipColour } | null;
  // Optional click-to-expand affordance (used by Treatments Accepted -> per-practice breakdown).
  onClick?: () => void; hint?: string; active?: boolean;
  // Optional navigation: clicking the tile routes to a detail page (scope/period
  // query already appended). Mutually exclusive with onClick.
  href?: string;
};

// n/d as a percentage, rounded to `dp` decimals (default integer). 0 when d<=0.
function pctOf(n: number, d: number, dp = 0): number {
  if (d <= 0) return 0;
  const f = 10 ** dp;
  return Math.round((n / d) * 100 * f) / f;
}

// Source-group title above a row of headline cards (Dentally, QuickBooks, …).
// Rendered as a titled divider at the top of each section panel.
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-sm font-semibold uppercase tracking-wide text-ink mb-3 pb-2 border-b border-border">
      {children}
    </div>
  );
}

// One headline scorecard tile: label, big value, sub-line, optional status chip.
// When `onClick` is set the whole tile becomes a button (click-to-expand a
// breakdown), with a hover state, an `active` ring while open, and a hint line.
function HeadlineCard({ c }: { c: HeadlineKpi }) {
  const body = (
    <>
      <div className="text-xs text-ink-muted uppercase tracking-wide">{c.label}</div>
      <div className="text-xl font-bold tabular-nums tracking-tight mt-1">{c.value}</div>
      <div className="text-xs text-ink-muted mt-1">{c.sub}</div>
      {c.chip && <div className="mt-2"><Chip colour={c.chip.tone}>{c.chip.text}</Chip></div>}
      {c.hint && <div className="text-[11px] text-brand mt-2">{c.hint}</div>}
    </>
  );
  // Navigation tile: routes to a detail page (scope/period preserved on the href).
  if (c.href) {
    return (
      <Link href={c.href}
        className="card-padded flex flex-col min-w-0 text-left transition-colors hover:border-brand-200 cursor-pointer">
        {body}
      </Link>
    );
  }
  if (!c.onClick) return <div className="card-padded flex flex-col min-w-0">{body}</div>;
  return (
    <button type="button" onClick={c.onClick} aria-expanded={c.active}
      className={'card-padded flex flex-col min-w-0 text-left transition-colors hover:border-brand-200 '
        + (c.active ? 'ring-1 ring-brand border-brand' : '')}>
      {body}
    </button>
  );
}

export function GroupPerformanceScreen() {
  const { scope, setScope, win } = useScopePeriod();
  const searchParams = useSearchParams();
  // Scope + period live in the URL query, so carry them when routing from a card
  // to its detail page — the target page then opens on the same practice/window.
  const to = (path: string) => {
    const qs = searchParams.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const { data, isLoading, isError } = useBusinessHub();

  // Per-section filters, each shown directly above its own data-source block and
  // re-scoping only that source's cards. The global period filter (win) applies
  // to every section.
  // Dentally → practices (drives the global scope). Only real Dentally-mapped
  // sites (non-null pms_site_id); practices auto-created by GHL/QuickBooks
  // account mapping carry no pms_site_id and don't belong in the Dentally filter.
  const { data: practicesData } = usePractices();
  const practiceOptions = (practicesData?.practices ?? [])
    .filter((p) => p.pms_site_id)
    .map((p) => ({ id: p.id, label: p.name }));
  // Marketing → per-provider ad accounts. null = all selected accounts for that
  // provider; a customer_id narrows to one account.
  const [metaId, setMetaId] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const accountIds = [metaId, googleId].filter(Boolean) as string[];
  // Pin marketing to group scope — ad spend isn't practice-attributed, so a
  // selected practice must not empty the marketing cards / snapshot.
  const { data: roi } = useMarketingRoi(accountIds.length ? accountIds : undefined, 'all');
  // QuickBooks → connected company. The roll-up section owns its own period
  // filter (clean YYYY-MM, mirroring the Finance > QuickBooks screen).
  const [qbAccountId, setQbAccountId] = useState<string | null>(null);
  const { data: qbAll } = useQuery({ queryKey: ['qbo-finance', 'accounts'], queryFn: () => getQuickBooksOverview({}) });
  const qbOptions = (qbAll?.accounts ?? []).map((a) => ({ id: a.id, label: a.companyName }));
  // GoHighLevel → connected subaccount. The all-accounts dashboard supplies the
  // filter options; GhlSummaryCards re-fetches scoped to the selection.
  const [ghlAccountId, setGhlAccountId] = useState<string | null>(null);
  // Treatments Accepted card → click-to-expand per-practice breakdown.
  const [acceptedOpen, setAcceptedOpen] = useState(false);
  // Plan Fees Collected card → click-to-expand the invoice lines behind it.
  const [plansOpen, setPlansOpen] = useState(false);
  const { data: ghlAll } = useGhlDashboard({ since: win.since, until: win.until });
  const ghlOptions = (ghlAll?.perAccount ?? [])
    .filter((a) => a.accountId)
    .map((a) => ({ id: a.accountId as string, label: a.label }));
  // Lazy drill-down for the Plan Fees Collected card — only fetched once opened,
  // scoped to the selected practice (group buckets pass no practice filter) +
  // the global window. Hook must sit above the early returns below (rules-of-hooks).
  const planScopeIsGroup = scope === 'all' || scope === 'practices' || scope === 'academy' || scope === 'lab';
  const planFees = usePlanFeesLines({ enabled: plansOpen, practiceId: planScopeIsGroup ? null : scope });

  if (isLoading)
    return (
      <div>
        <SkeletonKpiRow count={4} className="mb-6" />
        <SkeletonChart height={280} />
      </div>
    );
  if (isError || !data) return <AlertRow tone="bad" title="Couldn't load group performance" />;

  const g = data.group;
  const windowLabel = data.period.label ?? `last ${data.period.days}d`;
  // Scope -> which practices the Business Performance table shows. Turnover IS
  // per-practice, so a specific practice narrows the table to that row (+ the
  // group total). The funnel KPIs above stay group-wide (treatment plans + leads
  // aren't practice-attributed) — we say so when a practice is selected.
  const isGroupScope = scope === 'all' || scope === 'practices' || scope === 'academy' || scope === 'lab';
  const practices = isGroupScope ? data.practices : data.practices.filter((p) => p.practiceId === scope);
  const maxTakings = Math.max(1, ...data.practices.map((p) => p.takingsPence));
  // Treatments Closed + turnover ARE practice-attributed (invoice_items feed), so
  // a specific practice scopes them to that row. Leads/new-patients are NOT, so
  // avg-value / rev-per-lead stay group-wide (handled below on g.*).
  const scopedRow = isGroupScope ? null : data.practices.find((p) => p.practiceId === scope) ?? null;
  const closedPence = scopedRow ? scopedRow.treatmentsClosedPence : g.treatmentsClosedPence;
  const paidPence = scopedRow ? scopedRow.treatmentsPaidPence : g.treatmentsPaidPence;
  const closedTurnoverBase = scopedRow ? scopedRow.revenuePence : g.revenuePence;
  // Treatments Completed (Practitioner Activity feed) IS practice-attributed (via
  // the practitioner's site), so a selected practice scopes the card to that row.
  const completedCount = scopedRow ? scopedRow.treatmentsCompleted : g.treatmentsCompleted;
  const completedValuePence = scopedRow ? scopedRow.treatmentsCompletedValuePence : g.treatmentsCompletedValuePence;
  // Takings = settled payments received (matches the Patient Payments "Received"
  // tile). Per-practice when scoped, group total otherwise.
  const takingsPence = scopedRow ? scopedRow.takingsPence : g.takingsPence;

  // Treatments Accepted (Emergent) — practice-attributed via the per-practice
  // breakdown. A selected practice scopes the card to that row (0 if it has no
  // accepted rows); group scope shows the org total. The breakdown also drives
  // the click-to-expand table below, which marks the row the card reflects.
  const acceptedRows = g.treatmentsAcceptedByPractice ?? [];
  const acceptedScopedRow = isGroupScope ? null : acceptedRows.find((r) => r.practiceId === scope) ?? null;
  const acceptedCount = isGroupScope ? g.treatmentsAcceptedCount : (acceptedScopedRow?.count ?? 0);
  const acceptedValuePence = isGroupScope ? g.treatmentsAcceptedValuePence : (acceptedScopedRow?.valuePence ?? 0);
  const acceptedScopeLabel = isGroupScope
    ? 'All practices'
    : (acceptedScopedRow?.name ?? practiceOptions.find((p) => p.id === scope)?.label ?? 'Selected practice');

  // Headline KPIs — the group business scorecard. Real feeds: Dentally
  // (turnover, cash banked, treatments, leads) + ads via marketing ROI (spend,
  // ROAS, cost/patient). Group profit needs a P&L margin (Xero/QuickBooks) and
  // shows "—" until connected; ad-derived cards show "—" until ads are mapped.
  const connected = !!roi?.connected;
  const spendPence = connected ? roi!.paidSpendPence : 0;
  const roas = connected ? (roi!.blendedRoas ?? 0) : 0;

  const profitPence = g.marginPct > 0 ? Math.round((g.revenuePence * g.marginPct) / 100) : 0;
  const spendPctTurnover = pctOf(spendPence, g.revenuePence, 1);
  // New patients follow the practice scope (Dentally registrations are
  // practice-attributed): a selected practice shows that site's count, group
  // scope shows the sum. avgPatientValue/costPerPatient below derive from it.
  const newPts = scopedRow ? scopedRow.newPatients : g.newPatients;
  const avgPatientValuePence = newPts > 0 ? Math.round(g.treatmentsClosedPence / newPts) : 0;
  const costPerPatientPence = connected && newPts > 0 ? Math.round(spendPence / newPts) : 0;
  const closedPctTurnover = pctOf(closedPence, closedTurnoverBase);
  const collectedPct = pctOf(paidPence, closedPence); // share of billed plan fees collected
  // Treatments started is a COUNT, not a % of leads: Dentally treatment plans
  // (existing patients) and GHL leads (new marketing) are different populations,
  // so "started ÷ leads" can exceed 100% and means nothing.
  const revPerLead = g.leads > 0 ? Math.round(g.treatmentsClosedPence / g.leads) : 0;
  const costPerStart = connected && g.treatmentsStarted > 0 ? Math.round(spendPence / g.treatmentsStarted) : 0;
  const roasTone: ChipColour = roas >= 4 ? 'emerald' : roas >= 2 ? 'amber' : 'rose';
  const roasLabel = roas >= 4 ? 'Strong' : roas >= 2 ? 'Watch' : 'Weak';

  // Period-over-period delta chips — turnover and cash vs the prior same-length
  // window (server-side, like-for-like). null base => no chip. Up = emerald.
  const deltaChip = (pct: number | null): { text: string; tone: ChipColour } | null =>
    pct == null ? null : { text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${g.prevPeriodLabel}`, tone: pct >= 0 ? 'emerald' : 'rose' };
  // Takings delta = settled-receipts (cash) delta vs the prior same-length period.
  const cashChip = deltaChip(g.cashDeltaPct);

  // Merged-in Group-Overview metrics (appointments / no-show / leads), scoped to
  // the selected practice where the feed is practice-attributed.
  const apptCount = scopedRow ? scopedRow.appointments : g.appointments;
  const apptCompleted = scopedRow ? scopedRow.completed : data.practices.reduce((s, p) => s + p.completed, 0);
  const noShowRateVal = scopedRow ? scopedRow.noShowRate : g.noShowRate;
  const leadsBreakdown = (g.leadsBySource ?? [])
    .map((s) => `${s.source.split(' ')[0]} ${formatNumber(s.leads)}`).join(' · ');

  // Headline cards grouped by data source, each under its own label. Every card
  // for a source lives in that source's section (no duplicate sections).
  // Dentally — payments (takings), treatment plans, appointments, invoiced fees.
  const dentallyCards: HeadlineKpi[] = [
    // Takings = settled payments received (same feed as the Patient Payments
    // "Received" tile, so the two screens reconcile); chip = like-for-like delta.
    { label: 'Takings', value: formatPence(takingsPence), sub: `Settled payments received · ${windowLabel}`,
      chip: cashChip, href: to('/payments'), hint: 'Open Payments →' },
    { label: 'Treatments Completed', value: formatNumber(completedCount), sub: `Completed by practitioners · ${windowLabel}`,
      chip: completedValuePence > 0 ? { text: `${formatPence(completedValuePence)} of work done`, tone: 'emerald' } : null,
      href: to('/clinicians'), hint: 'Open Clinicians →' },
    // Treatments Accepted is sourced from the Emergent ops app, but grouped here
    // with the other treatment cards. Placeholder until Emergent is connected.
    // Click-to-expand reveals the per-practice breakdown; the card value follows
    // the selected practice filter (scope), and the sub-line names which filter
    // it currently reflects.
    { label: 'Treatments Accepted', value: acceptedCount > 0 ? formatNumber(acceptedCount) : DASH,
      sub: g.treatmentsAcceptedCount > 0 ? `Accepted (Emergent) · ${acceptedScopeLabel} · ${windowLabel}` : 'Connect Emergent to track acceptance',
      chip: acceptedValuePence > 0 ? { text: `${formatPence(acceptedValuePence)} value`, tone: 'emerald' } : null,
      onClick: acceptedRows.length > 0 ? () => setAcceptedOpen((v) => !v) : undefined,
      active: acceptedOpen,
      hint: acceptedRows.length > 0 ? (acceptedOpen ? 'Hide breakdown' : 'Click for practice breakdown') : undefined },
    { label: 'Treatments Closed', value: formatPence(closedPence), sub: `Plan fees billed · ${windowLabel}`,
      chip: closedPctTurnover > 0 ? { text: `${closedPctTurnover}% of turnover from plans`, tone: 'emerald' } : null,
      href: to('/treatments'), hint: 'Open Treatments →' },
    { label: 'Treatment Plan Fees Collected', value: formatPence(paidPence), sub: `Collected on treatment plans · ${windowLabel}`,
      chip: collectedPct > 0 ? { text: `${collectedPct}% of billed paid`, tone: collectedPct >= 80 ? 'emerald' : 'amber' } : null,
      onClick: paidPence > 0 ? () => setPlansOpen((v) => !v) : undefined,
      active: plansOpen,
      hint: paidPence > 0 ? (plansOpen ? 'Hide invoice lines' : 'Click to see every plan line') : undefined },
    { label: 'Appointments', value: formatNumber(apptCount), sub: `${formatNumber(apptCompleted)} completed · ${windowLabel}`,
      chip: null, href: to('/appointments'), hint: 'Open Appointments →' },
    { label: 'No-show rate', value: g.noShowTracked ? `${noShowRateVal}%` : DASH, sub: g.noShowTracked ? 'Missed appointments' : 'Not tracked in Dentally',
      chip: null, href: g.noShowTracked ? to('/appointments') : undefined, hint: g.noShowTracked ? 'Open Appointments →' : undefined },
    { label: 'New Patients', value: formatNumber(newPts), sub: avgPatientValuePence > 0 ? `${formatPence(avgPatientValuePence)} avg value` : 'New-patient exams booked (Dentally)',
      chip: costPerPatientPence > 0 ? { text: `${formatPence(costPerPatientPence)} cost / patient`, tone: 'emerald' } : null,
      href: to('/patients'), hint: 'Open Patients →' },
  ];
  // QuickBooks / Xero — P&L actuals (profit + net margin).
  const quickbooksCards: HeadlineKpi[] = [
    { label: 'Group Profit', value: g.marginPct > 0 ? formatPence(profitPence) : DASH, sub: g.marginPct > 0 ? `Contribution · ${g.marginPct}% of turnover` : 'Connect Xero for live P&L',
      chip: g.marginPct > 0 ? { text: `${g.marginPct}% of turnover`, tone: 'emerald' } : null },
    { label: 'Margin', value: g.marginPct > 0 ? `${g.marginPct}%` : DASH, sub: g.marginPct > 0 ? 'Net, from actuals' : 'Connect Xero / QuickBooks',
      chip: null },
  ];
  // Marketing — paid spend/ROAS + the lead→treatment acquisition funnel.
  const marketingCards: HeadlineKpi[] = [
    { label: 'Leads', value: formatNumber(g.leads), sub: leadsBreakdown || 'Google · Meta · GHL',
      chip: null },
    { label: 'Conversion', value: `${g.conversionRate}%`, sub: 'Leads → new patients booked',
      chip: null },
    { label: 'Marketing Spend', value: connected ? formatPence(spendPence) : DASH, sub: connected ? 'Tracked acquisition spend' : 'Connect Google / Meta Ads',
      chip: connected ? { text: `${spendPctTurnover}% of turnover`, tone: 'amber' } : null },
    { label: 'Blended Paid ROAS', value: roas > 0 ? `${roas.toFixed(2)}×` : DASH, sub: 'Paid revenue ÷ paid spend',
      chip: roas > 0 ? { text: roasLabel, tone: roasTone } : null },
    { label: 'Lead → Start Rate', value: `${g.leadToStartRate}%`, sub: `${formatNumber(g.treatmentsStarted)} treatments started from ${formatNumber(g.leads)} leads`,
      chip: g.treatmentsCompleted > 0 ? { text: `${formatNumber(g.treatmentsCompleted)} completed`, tone: 'emerald' } : null },
    { label: 'Cost / Treatment Started', value: costPerStart > 0 ? formatPence(costPerStart) : DASH, sub: 'Paid spend ÷ treatments started',
      chip: connected && spendPence > 0 ? { text: `${formatPence(spendPence)} paid`, tone: 'amber' } : null },
    { label: 'Revenue / Lead', value: formatPence(revPerLead), sub: 'Dentally plan fees ÷ leads (Google · Meta · GHL)',
      chip: g.treatmentsClosedPence > 0 ? { text: `${formatPence(g.treatmentsClosedPence)} plan revenue`, tone: 'emerald' } : null },
  ];

  // Paid channels only (Google + Meta) — real spend/leads from ad_metrics.
  const channels = roi?.connected ? roi.channels.filter((c) => c.paid) : [];
  const adAccounts = roi?.connected ? (roi.byAccount ?? []) : [];
  const lens = buildLens(practices, g.marginPct, roi);

  // Clinical revenue lines from Dentally invoice items (group-wide).
  const lines = data.revenueByLine ?? [];
  const costConnected = data.revenueLineCostBasis != null; // Xero/QuickBooks P&L feed present

  return (
    <div className="flex flex-col gap-5">
      {/* Headline scorecard — grouped by data source, one bordered panel per
          source, each with its own filter directly above it. The global period
          filter (top of page) applies to every section. */}
      <Card>
        <SectionLabel>Dentally</SectionLabel>
        <SectionFilterPills label="Practice" options={practiceOptions}
          selectedId={scope === 'all' ? null : scope}
          onSelect={(id) => setScope(id ?? 'all')} allLabel="All practices" />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {dentallyCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
        </div>
        {acceptedOpen && acceptedRows.length > 0 && (
          <TreatmentsAcceptedBreakdown rows={acceptedRows} scope={isGroupScope ? null : scope}
            total={{ count: g.treatmentsAcceptedCount, valuePence: g.treatmentsAcceptedValuePence }} />
        )}
        {plansOpen && (
          <PlanFeesLinesBreakdown
            loading={planFees.isLoading}
            error={planFees.isError}
            lines={planFees.data?.lines ?? []}
            totals={planFees.data?.totals ?? { billedPence: closedPence, collectedPence: paidPence, lineCount: 0 }}
            note={planFees.data?.note ?? ''} />
        )}
      </Card>

      <Card>
        <SectionLabel>Marketing</SectionLabel>
        {/* Per-provider ad-account filter — built from the org's REAL connected
            Google and Meta accounts; hides itself with fewer than two accounts. */}
        <AdAccountFilter metaId={metaId} googleId={googleId} onSelectMeta={setMetaId} onSelectGoogle={setGoogleId} />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {marketingCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
        </div>

        {/* Marketing Snapshot — real Google + Meta spend/leads per channel,
            reactive to the period bar + ad-account filter. Group-wide (ad spend
            isn't practice-attributed). Per-channel revenue/ROAS isn't
            attributable, so they show as — (blended ROAS only). */}
        <div className="mt-5 pt-4 border-t border-border">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="display text-base font-semibold">Marketing Snapshot</h3>
              <p className="text-sm text-ink-muted mt-0.5">Real Google Ads + Meta spend, leads and conversions across your paid channels.</p>
            </div>
            {roi?.connected && roi.blendedRoas != null && roi.blendedRoas > 0 && (
              <Chip colour="emerald">{roi.blendedRoas.toFixed(2)}× blended ROAS</Chip>
            )}
          </div>
          {channels.length === 0 ? (
            <EmptyState message="No ad spend in this window. Connect Google Ads / Meta in Data Hub." />
          ) : (
            <>
            <div className="grid gap-3 mt-3 grid-cols-1 md:grid-cols-3">
              {channels.map((c) => (
                <div key={c.key} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold flex items-center gap-2">
                      <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                      {c.label}
                    </span>
                    <span className="text-2xl font-bold">{c.ctrPct > 0 ? `${c.ctrPct.toFixed(1)}%` : DASH}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                    <ChannelStat label="Spend" value={formatPence(c.spendPence)} />
                    <ChannelStat label="Cost / lead" value={c.costPerAdConvPence ? formatPence(c.costPerAdConvPence) : DASH} />
                    <ChannelStat label="Leads" value={formatNumber(c.adConversions)} />
                    <ChannelStat label="Clicks" value={formatNumber(c.clicks)} />
                  </div>
                </div>
              ))}
            </div>
            {adAccounts.length > 1 && (
              <div className="mt-4">
                <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">By ad account</div>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="right">Spend</th>
                        <th className="right">Impressions</th>
                        <th className="right">Clicks</th>
                        <th className="right">Reach</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adAccounts.map((a) => (
                        <tr key={`${a.provider}-${a.customerId}`}>
                          <td>
                            <strong>{a.name || a.customerId}</strong>
                            <span className="text-ink-muted ml-1 capitalize" style={{ fontSize: 11 }}>
                              {a.provider.replace('_', ' ')}{a.currency ? ` · ${a.currency}` : ''}
                            </span>
                          </td>
                          <td className="right">{formatPence(a.spendPence)}</td>
                          <td className="right">{formatNumber(a.impressions)}</td>
                          <td className="right">{formatNumber(a.clicks)}</td>
                          <td className="right">{formatNumber(a.reach)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-ink-muted mt-2">
                  Showing your selected ad accounts. Change which accounts are included in Data Hub → Integrations.
                </p>
              </div>
            )}
            </>
          )}
        </div>
      </Card>

      <Card>
        <SectionLabel>QuickBooks</SectionLabel>
        <SectionFilterPills label="Company" options={qbOptions}
          selectedId={qbAccountId} onSelect={setQbAccountId} allLabel="All companies" />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {quickbooksCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
        </div>
      </Card>

      {/* QuickBooks group roll-up — scoped by the company filter; owns its own
          period filter (mirrors the Finance > QuickBooks screen's clean `period`
          param, not the global ISO window which is off-by-one under BST). */}
      <QuickBooksGroupSection accountId={qbAccountId} />

      <Card>
        <SectionLabel>GoHighLevel</SectionLabel>
        <SectionFilterPills label="Subaccount" options={ghlOptions}
          selectedId={ghlAccountId} onSelect={setGhlAccountId} allLabel="All subaccounts" />
        <GhlSummaryCards since={win.since} until={win.until} accountId={ghlAccountId} />
      </Card>

      {!isGroupScope && (
        <AlertRow tone="info" title="Some funnel KPIs stay group-wide"
          body="Treatments Closed narrows to the selected practice (real invoiced fees). Lead-based KPIs (lead→start, cost/treatment, revenue/lead) stay group-wide — GHL leads aren't attributed per practice. The Business Performance table below narrows to the selected practice." />
      )}

      {/* Business Performance + Decision Lens */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <h3 className="display text-lg font-semibold">Business Performance</h3>
          <p className="text-sm text-ink-muted mt-0.5 mb-3">Takings and Closed are live from Dentally. Profit, margin and ROAS need Xero + ad mapping — shown once connected.</p>
          <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Entity</th>
                <th className="right">Takings</th>
                <th className="right">Closed</th>
                <th className="right">Profit</th>
                <th className="right">Margin</th>
                <th className="right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {practices.map((p) => (
                <tr key={p.practiceId}>
                  <td><strong>{p.name}</strong></td>
                  <td className="right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="inline-block h-1.5 w-16 rounded-full bg-border overflow-hidden">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${(p.takingsPence / maxTakings) * 100}%` }} />
                      </span>
                      {formatPence(p.takingsPence)}
                    </div>
                  </td>
                  <td className="right">{formatPence(p.treatmentsClosedPence)}</td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td><strong>Group</strong></td>
                <td className="right">{formatPence(g.takingsPence)}</td>
                <td className="right">{formatPence(g.treatmentsClosedPence)}</td>
                <td className="right">{DASH}</td>
                <td className="right">{g.marginPct > 0 ? `${g.marginPct}%` : DASH}</td>
                <td className="right">{DASH}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </Card>

        <Card>
          <h3 className="display text-lg font-semibold mb-1">Decision Lens</h3>
          <p className="text-sm text-ink-muted mb-3">What to act on this week.</p>
          <DecisionLens surface="group" fallback={lens} />
        </Card>
      </div>

      {/* QuickBooks (by company) — P&L actuals per connected QuickBooks company.
          Deliberately separate from the Dentally Business Performance table above:
          QuickBooks companies are NOT mapped to Dentally practices, so they list
          as their own entities (Revenue/Profit/Margin) rather than merged rows.
          Trailing 12 months (the `qbAll` overview, all companies summed). */}
      {(qbAll?.companies?.length ?? 0) > 0 && (
        <Card>
          <h3 className="display text-lg font-semibold">QuickBooks (by company)</h3>
          <p className="text-sm text-ink-muted mt-0.5 mb-3">Live P&amp;L per connected QuickBooks company · last 12 months. Not mapped to Dentally practices — shown separately.</p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th className="right">Revenue</th>
                  <th className="right">Profit</th>
                  <th className="right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {qbAll!.companies.map((c) => (
                  <tr key={c.accountId}>
                    <td><strong>{c.companyName}</strong></td>
                    <td className="right">{formatPence(c.revenuePence)}</td>
                    <td className="right" style={{ color: c.netProfitPence >= 0 ? '#047857' : '#B91C1C' }}>{formatPence(c.netProfitPence)}</td>
                    <td className="right">{c.revenuePence > 0 ? `${c.netMarginPct}%` : DASH}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td><strong>Group</strong></td>
                  <td className="right">{formatPence(qbAll!.summary.revenuePence)}</td>
                  <td className="right" style={{ color: qbAll!.summary.netProfitPence >= 0 ? '#047857' : '#B91C1C' }}>{formatPence(qbAll!.summary.netProfitPence)}</td>
                  <td className="right">{qbAll!.summary.revenuePence > 0 ? `${qbAll!.summary.netMarginPct}%` : DASH}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Revenue by Line + Profit Contribution — live from Dentally invoice
          items, bucketed into clinical treatment lines. Costs (Xero/QuickBooks)
          are not connected, so contribution is gross (cost £0). */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="display text-lg font-semibold">Revenue by Line</h3>
            <Link href={to('/crm-reports')} className="text-xs text-brand hover:underline whitespace-nowrap">Open report →</Link>
          </div>
          <p className="text-sm text-ink-muted mt-0.5">Where group turnover comes from — clinical treatment lines · {windowLabel}.</p>
          {lines.length === 0
            ? <EmptyState message="No invoiced treatments from Dentally in this window yet." />
            : <RevenueLineBars lines={lines} metric="fee" />}
        </Card>

        <Card>
          <h3 className="display text-lg font-semibold">Profit Contribution</h3>
          <p className="text-sm text-ink-muted mt-0.5">
            {costConnected
              ? `Net contribution by line · allocated at the ${data.revenueLineMarginPct}% group P&L margin (Xero/QuickBooks).`
              : 'Treatment lines ranked by contribution · costs £0 until a P&L feed (Xero/QuickBooks) is connected.'}
          </p>
          {lines.length === 0
            ? <EmptyState message="No invoiced treatments from Dentally in this window yet." />
            : <RevenueLineBars lines={lines} metric={costConnected ? 'profit' : 'fee'} showShare />}
        </Card>
      </div>
    </div>
  );
}

// Clinical treatment lines as labelled bars, high-to-low. metric selects the
// value: 'fee' = invoiced revenue (Revenue by Line); 'profit' = net contribution
// after allocated cost (Profit Contribution, only when a P&L feed is connected).
// showShare adds each line's % of the metric total.
function RevenueLineBars({ lines, metric, showShare = false }: { lines: RevenueLine[]; metric: 'fee' | 'profit'; showShare?: boolean }) {
  const valueOf = (l: RevenueLine) => (metric === 'profit' ? l.profit_pence : l.fee_pence);
  const total = lines.reduce((s, l) => s + valueOf(l), 0);
  const max = Math.max(1, ...lines.map(valueOf));
  return (
    <div className="flex flex-col gap-2.5 mt-3">
      {lines.map((l) => (
        <div key={l.line}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{l.line}</span>
            <span className="tabular-nums">
              {formatPence(valueOf(l))}
              {showShare && <span className="text-ink-muted text-xs ml-1.5">{total > 0 ? Math.round((valueOf(l) / total) * 100) : 0}%</span>}
            </span>
          </div>
          <div className="h-2 mt-1 rounded-full bg-[var(--border)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.round((valueOf(l) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Treatments Accepted, split by practice (Emergent feed). The highlighted row is
// the one the card value currently reflects: the selected practice, or the
// "All practices" total when no practice filter is applied. Unmapped = Emergent
// records whose business name didn't resolve to a practice.
function TreatmentsAcceptedBreakdown(
  { rows, scope, total }: {
    rows: { practiceId: string | null; name: string; count: number; valuePence: number }[];
    scope: string | null;
    total: { count: number; valuePence: number };
  },
) {
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">Treatments Accepted by practice</div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Practice</th>
              <th className="right">Accepted</th>
              <th className="right">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = scope != null && r.practiceId === scope;
              return (
                <tr key={r.practiceId ?? 'unmapped'} className={active ? 'bg-brand-50' : undefined}>
                  <td><strong>{r.name}</strong>{active && <span className="ml-2"><Chip colour="emerald">Showing</Chip></span>}</td>
                  <td className="right">{formatNumber(r.count)}</td>
                  <td className="right">{formatPence(r.valuePence)}</td>
                </tr>
              );
            })}
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}
              className={scope == null ? 'bg-brand-50' : undefined}>
              <td><strong>All practices</strong>{scope == null && <span className="ml-2"><Chip colour="emerald">Showing</Chip></span>}</td>
              <td className="right">{formatNumber(total.count)}</td>
              <td className="right">{formatPence(total.valuePence)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted mt-2">Click a practice pill above to scope the card; Unmapped rows are Emergent records whose business name didn&apos;t match a practice.</p>
    </div>
  );
}

// Plan Fees Collected → every treatment-plan invoice line behind the number.
// Full source transparency: per line we show the billed fee, the collected
// share, and the invoice gross/outstanding the pro-rata is derived from. Totals
// are canonical (from the aggregate), so they reconcile to the card exactly.
function PlanFeesLinesBreakdown(
  { loading, error, lines, totals, note }: {
    loading: boolean;
    error: boolean;
    lines: PlanFeeLine[];
    totals: { billedPence: number; collectedPence: number; lineCount: number };
    note: string;
  },
) {
  const fmtDate = (d: string) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const pct = (paid: number, billed: number) => (billed > 0 ? Math.round((100 * paid) / billed) : 0);
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-xs text-ink-muted uppercase tracking-wide">Treatment plan fees — invoice lines</div>
        <div className="text-xs text-ink-muted">
          {formatNumber(totals.lineCount)} lines · {formatPence(totals.collectedPence)} collected of {formatPence(totals.billedPence)} billed
        </div>
      </div>
      {loading && <p className="text-sm text-ink-muted py-4">Loading invoice lines…</p>}
      {error && <p className="text-sm text-red-600 py-4">Could not load the invoice lines. Try again.</p>}
      {!loading && !error && lines.length === 0 && (
        <p className="text-sm text-ink-muted py-4">No treatment-plan invoice lines in this window.</p>
      )}
      {!loading && !error && lines.length > 0 && (
        <div className="overflow-auto" style={{ maxHeight: 480 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Practice</th>
                <th>Treatment</th>
                <th>Invoice</th>
                <th className="right">Billed</th>
                <th className="right">Collected</th>
                <th className="right">Paid %</th>
                <th className="right">Inv. gross</th>
                <th className="right">Inv. outstanding</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = pct(l.collectedPence, l.billedPence);
                return (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{fmtDate(l.invoicedOn)}</td>
                    <td>{l.patientName ?? DASH}</td>
                    <td>{l.practiceName ?? DASH}</td>
                    <td>{l.treatmentName ?? DASH}</td>
                    <td className="whitespace-nowrap text-ink-muted">{l.invoiceId ?? DASH}</td>
                    <td className="right">{formatPence(l.billedPence)}</td>
                    <td className="right">{formatPence(l.collectedPence)}</td>
                    <td className="right">
                      <Chip colour={p >= 80 ? 'emerald' : p > 0 ? 'amber' : 'slate'}>{p}%</Chip>
                    </td>
                    <td className="right text-ink-muted">{l.invoiceAmountPence == null ? DASH : formatPence(l.invoiceAmountPence)}</td>
                    <td className="right text-ink-muted">{l.invoiceOutstandingPence == null ? DASH : formatPence(l.invoiceOutstandingPence)}</td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td colSpan={5}><strong>Total ({formatNumber(totals.lineCount)} lines)</strong></td>
                <td className="right">{formatPence(totals.billedPence)}</td>
                <td className="right">{formatPence(totals.collectedPence)}</td>
                <td className="right">{pct(totals.collectedPence, totals.billedPence)}%</td>
                <td className="right" />
                <td className="right" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="text-xs text-ink-muted mt-2">{note}</p>}
    </div>
  );
}

function ChannelStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}

type Lens = { tone: 'good' | 'warn' | 'bad' | 'info'; icon: JSX.Element; title: string; body: string };

// Decision Lens — derived from live Dentally + ads data only.
function buildLens(rows: HubPractice[], marginPct: number, roi: MarketingRoi | undefined): Lens[] {
  if (!rows.length) return [];
  const out: Lens[] = [];

  const topRev = [...rows].sort((a, b) => b.revenuePence - a.revenuePence)[0];
  out.push({ tone: 'good', icon: <ArrowUpRight size={16} />, title: `${topRev.name} leads on turnover`, body: `${formatPence(topRev.revenuePence)} in the window — protect its diary and replicate the mix.` });

  const worstNoShow = [...rows].filter((p) => p.appointments > 0).sort((a, b) => b.noShowRate - a.noShowRate)[0];
  if (worstNoShow && worstNoShow.noShowRate > 0)
    out.push({ tone: 'warn', icon: <AlertTriangle size={16} />, title: `${worstNoShow.name} no-show rate ${worstNoShow.noShowRate}%`, body: `${formatNumber(worstNoShow.noShows)} missed appointments — reminders, deposits and speed-to-lead are the cheapest fix.` });

  const paid = roi?.connected ? roi.channels.filter((c) => c.paid) : [];
  if (paid.length > 0) {
    const top = [...paid]
      .filter((p) => p.adConversions > 0 && p.costPerAdConvPence > 0)
      .sort((a, b) => a.costPerAdConvPence - b.costPerAdConvPence)[0];
    if (top)
      out.push({ tone: 'info', icon: <Gem size={16} />, title: `${top.label} is your cheapest channel`, body: `${formatPence(top.costPerAdConvPence)} per lead from ${formatPence(top.spendPence)} spend — shift budget to the winner.` });
  }

  out.push({ tone: marginPct >= 18 ? 'good' : 'bad', icon: <TrendingDown size={16} />, title: marginPct > 0 ? `Group net margin ${marginPct}%` : 'No margin data yet', body: marginPct >= 18 ? 'Healthy against the ~18% dental benchmark.' : marginPct > 0 ? 'Below the ~18% benchmark — wage ratio and lab/materials are the usual leak.' : 'Connect Xero for live P&L margin.' });
  return out.slice(0, 4);
}
