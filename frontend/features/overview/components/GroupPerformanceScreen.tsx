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
import { AlertTriangle, ArrowUpRight, Gem, TrendingDown } from 'lucide-react';
import { Card, Chip, AlertRow, EmptyState, SkeletonKpiRow, SkeletonChart, type ChipColour } from '@/components/ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useBusinessHub, type HubPractice, type RevenueLine } from '../business-hub-api';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useMarketingRoi } from '@/features/intelligence/marketing-roi-hooks';
import type { MarketingRoi } from '@/features/intelligence/marketing-roi-api';
import { AdAccountFilter } from '@/features/intelligence/AdAccountFilter';

const DASH = '—';

type HeadlineKpi = { label: string; value: string; sub: string; chip: { text: string; tone: ChipColour } | null };

// n/d as a percentage, rounded to `dp` decimals (default integer). 0 when d<=0.
function pctOf(n: number, d: number, dp = 0): number {
  if (d <= 0) return 0;
  const f = 10 ** dp;
  return Math.round((n / d) * 100 * f) / f;
}

// One headline scorecard tile: label, big value, sub-line, optional status chip.
function HeadlineCard({ c }: { c: HeadlineKpi }) {
  return (
    <div className="card-padded flex flex-col">
      <div className="text-xs text-ink-muted uppercase tracking-wide">{c.label}</div>
      <div className="display text-2xl font-bold mt-1">{c.value}</div>
      <div className="text-xs text-ink-muted mt-1">{c.sub}</div>
      {c.chip && <div className="mt-2"><Chip colour={c.chip.tone}>{c.chip.text}</Chip></div>}
    </div>
  );
}

export function GroupPerformanceScreen() {
  const { scope } = useScopePeriod();
  const { data, isLoading, isError } = useBusinessHub();
  // Dynamic per-provider ad-account filter for the marketing snapshot. null = all
  // selected accounts for that provider; a customer_id narrows to one account.
  const [metaId, setMetaId] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const accountIds = [metaId, googleId].filter(Boolean) as string[];
  const { data: roi } = useMarketingRoi(accountIds.length ? accountIds : undefined);

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
  const maxTurnover = Math.max(1, ...data.practices.map((p) => p.revenuePence));

  // Headline KPIs — the group business scorecard. Real feeds: Dentally
  // (turnover, cash banked, treatments, leads) + ads via marketing ROI (spend,
  // ROAS, cost/patient). Group profit needs a P&L margin (Xero/QuickBooks) and
  // shows "—" until connected; ad-derived cards show "—" until ads are mapped.
  const connected = !!roi?.connected;
  const spendPence = connected ? roi!.paidSpendPence : 0;
  const roas = connected ? (roi!.blendedRoas ?? 0) : 0;

  const profitPence = g.marginPct > 0 ? Math.round((g.revenuePence * g.marginPct) / 100) : 0;
  const vsBasePct = g.revenueTargetPence > 0
    ? Math.round(((g.revenuePence - g.revenueTargetPence) / g.revenueTargetPence) * 100) : null;
  const cashPct = pctOf(g.cashCollectedPence, g.revenuePence);
  const outstandingPence = Math.max(0, g.revenuePence - g.cashCollectedPence);
  const spendPctTurnover = pctOf(spendPence, g.revenuePence, 1);
  const newPts = g.newPatients;
  const avgPatientValuePence = newPts > 0 ? Math.round(g.treatmentsClosedPence / newPts) : 0;
  const costPerPatientPence = connected && newPts > 0 ? Math.round(spendPence / newPts) : 0;
  const closedPctTurnover = pctOf(g.treatmentsClosedPence, g.revenuePence);
  // Treatments started is a COUNT, not a % of leads: Dentally treatment plans
  // (existing patients) and GHL leads (new marketing) are different populations,
  // so "started ÷ leads" can exceed 100% and means nothing.
  const revPerLead = g.leads > 0 ? Math.round(g.treatmentsClosedPence / g.leads) : 0;
  const costPerStart = connected && g.treatmentsStarted > 0 ? Math.round(spendPence / g.treatmentsStarted) : 0;
  const roasTone: ChipColour = roas >= 4 ? 'emerald' : roas >= 2 ? 'amber' : 'rose';
  const roasLabel = roas >= 4 ? 'Strong' : roas >= 2 ? 'Watch' : 'Weak';

  // Row 1 — money + acquisition headline. Row 2 — the lead→treatment funnel.
  const headlineTop: HeadlineKpi[] = [
    { label: 'Group Turnover', value: formatPence(g.revenuePence), sub: `${windowLabel} · ${g.practices} ${g.practices === 1 ? 'entity' : 'entities'}`,
      chip: vsBasePct != null ? { text: `${vsBasePct >= 0 ? '▲' : '▼'} ${Math.abs(vsBasePct)}% vs base`, tone: vsBasePct >= 0 ? 'emerald' : 'rose' } : null },
    { label: 'Group Profit', value: g.marginPct > 0 ? formatPence(profitPence) : DASH, sub: g.marginPct > 0 ? `Contribution · ${g.marginPct}% of turnover` : 'Connect Xero for live P&L',
      chip: g.marginPct > 0 ? { text: `${g.marginPct}% of turnover`, tone: 'emerald' } : null },
    { label: 'Cash Collected', value: formatPence(g.cashCollectedPence), sub: `${cashPct}% of turnover banked`,
      chip: outstandingPence > 0 ? { text: `${formatPence(outstandingPence)} outstanding`, tone: 'amber' } : null },
    { label: 'Marketing Spend', value: connected ? formatPence(spendPence) : DASH, sub: connected ? 'Tracked acquisition spend' : 'Connect Google / Meta Ads',
      chip: connected ? { text: `${spendPctTurnover}% of turnover`, tone: 'amber' } : null },
    { label: 'Blended Paid ROAS', value: roas > 0 ? `${roas.toFixed(2)}×` : DASH, sub: 'Paid revenue ÷ paid spend',
      chip: roas > 0 ? { text: roasLabel, tone: roasTone } : null },
    { label: 'New Patients', value: formatNumber(newPts), sub: avgPatientValuePence > 0 ? `${formatPence(avgPatientValuePence)} avg value` : 'Leads reaching treatment',
      chip: costPerPatientPence > 0 ? { text: `${formatPence(costPerPatientPence)} cost / patient`, tone: 'emerald' } : null },
  ];
  const headlineFunnel: HeadlineKpi[] = [
    { label: 'Treatments Closed', value: formatPence(g.treatmentsClosedPence), sub: `Treatment value accepted · ${windowLabel}`,
      chip: closedPctTurnover > 0 ? { text: `${closedPctTurnover}% of turnover`, tone: 'emerald' } : null },
    { label: 'Lead → Start Rate', value: `${g.leadToStartRate}%`, sub: `${formatNumber(g.treatmentsStarted)} treatments started from ${formatNumber(g.leads)} leads`,
      chip: g.treatmentsCompleted > 0 ? { text: `${formatNumber(g.treatmentsCompleted)} accepted`, tone: 'emerald' } : null },
    { label: 'Cost / Treatment Started', value: costPerStart > 0 ? formatPence(costPerStart) : DASH, sub: 'Paid spend ÷ treatments started',
      chip: connected && spendPence > 0 ? { text: `${formatPence(spendPence)} paid`, tone: 'amber' } : null },
    { label: 'Revenue / Lead', value: formatPence(revPerLead), sub: 'Attributed value ÷ leads',
      chip: g.treatmentsClosedPence > 0 ? { text: `${formatPence(g.treatmentsClosedPence)} attributed`, tone: 'emerald' } : null },
  ];

  // Paid channels only (Google + Meta) — real spend/leads from ad_metrics.
  const channels = roi?.connected ? roi.channels.filter((c) => c.paid) : [];
  const adAccounts = roi?.connected ? (roi.byAccount ?? []) : [];
  const lens = buildLens(practices, g.marginPct, roi);

  // Clinical revenue lines from Dentally invoice items (group-wide).
  const lines = data.revenueByLine ?? [];
  const costConnected = data.revenueLineCostBasis != null; // Xero/QuickBooks P&L feed present

  return (
    <div className="flex flex-col gap-4">
      {/* Headline scorecard — money + acquisition (row 1), lead→treatment funnel (row 2) */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {headlineTop.map((c) => <HeadlineCard key={c.label} c={c} />)}
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {headlineFunnel.map((c) => <HeadlineCard key={c.label} c={c} />)}
      </div>

      {!isGroupScope && (
        <AlertRow tone="info" title="Funnel KPIs stay group-wide"
          body="Treatment plans and GHL leads aren't attributed per practice, so the four headline KPIs cover the whole group. The Business Performance table below narrows to the selected practice." />
      )}

      {/* Dynamic ad-account filter — built from the org's REAL connected Google
          and Meta accounts. Narrows the marketing snapshot per provider; hides
          itself when there are fewer than two accounts to choose between. */}
      <AdAccountFilter metaId={metaId} googleId={googleId} onSelectMeta={setMetaId} onSelectGoogle={setGoogleId} />

      {/* Marketing Snapshot — real Google + Meta spend/leads per channel, reactive
          to the Scope/Period bar and the ad-account filter above. Per-channel
          revenue/ROAS isn't attributable, so they show as — (blended ROAS only). */}
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="display text-lg font-semibold">Marketing Snapshot</h3>
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
                    <span className="display text-2xl font-bold">{c.ctrPct > 0 ? `${c.ctrPct.toFixed(1)}%` : DASH}</span>
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
      </Card>

      {/* Business Performance + Decision Lens */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <h3 className="display text-lg font-semibold">Business Performance</h3>
          <p className="text-sm text-ink-muted mt-0.5 mb-3">Turnover is live from Dentally. Cash, profit, margin and ROAS need Xero + ad mapping — shown once connected.</p>
          <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Entity</th>
                <th className="right">Turnover</th>
                <th className="right">Cash in</th>
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
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${(p.revenuePence / maxTurnover) * 100}%` }} />
                      </span>
                      {formatPence(p.revenuePence)}
                    </div>
                  </td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                  <td className="right">{DASH}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td><strong>Group</strong></td>
                <td className="right">{formatPence(g.revenuePence)}</td>
                <td className="right">{DASH}</td>
                <td className="right">{DASH}</td>
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
          {lens.length === 0
            ? <EmptyState message="No standout actions yet." />
            : lens.map((a, i) => <AlertRow key={i} tone={a.tone} icon={a.icon} title={a.title} body={a.body} />)}
        </Card>
      </div>

      {/* Revenue by Line + Profit Contribution — live from Dentally invoice
          items, bucketed into clinical treatment lines. Costs (Xero/QuickBooks)
          are not connected, so contribution is gross (cost £0). */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <h3 className="display text-lg font-semibold">Revenue by Line</h3>
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
