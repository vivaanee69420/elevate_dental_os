'use client';

// Group Performance — Intelligence-OS group blocks for the Business Hub:
// headline funnel KPIs, marketing snapshot, per-entity performance table,
// revenue-by-line, profit-contribution, and a decision lens.
//
// Wired to live data only. Real feeds today: Dentally (turnover, appts,
// no-show, leads, conversion via /api/analytics/business-hub) and GHL/ads
// (spend, leads, ROAS via /api/growth/marketing/roi). Anything with no source
// yet — treatment-value closed, cash collected, per-entity profit/margin/ROAS,
// revenue/profit by treatment line — renders zero or an empty state. Those fill
// in once Xero (P&L) and a treatment-production/price feed are connected.

import { AlertTriangle, ArrowUpRight, Gem, TrendingDown } from 'lucide-react';
import { Card, Chip, AlertRow, EmptyState, SkeletonKpiRow, SkeletonChart } from '@/components/ui';
import { formatPence, formatNumber } from '@/lib/format';
import { useBusinessHub, type HubPractice, type RevenueLine } from '../business-hub-api';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useMarketingRoi } from '@/features/growth/hooks';

const DASH = '—';

export function GroupPerformanceScreen() {
  const { scope } = useScopePeriod();
  const { data, isLoading, isError } = useBusinessHub();
  const { data: roi } = useMarketingRoi();

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

  // Funnel KPIs — real from Dentally treatment_plans + GHL leads + ad spend.
  const revPerLead = g.leads > 0 ? Math.round(g.treatmentsClosedPence / g.leads) : 0;
  const costPerStart = roi?.connected && g.treatmentsStarted > 0
    ? Math.round(roi.spend_pence / g.treatmentsStarted) : 0;
  // Treatments started is a COUNT, not a % of leads: Dentally treatment plans
  // (existing patients) and GHL leads (new marketing) are different populations,
  // so "started ÷ leads" can exceed 100% and means nothing. Show the raw count.
  const funnel = [
    { label: 'Treatments closed', value: formatPence(g.treatmentsClosedPence), sub: `Private value completed · ${windowLabel}` },
    { label: 'Treatments started', value: formatNumber(g.treatmentsStarted), sub: `Dentally plans · ${windowLabel}` },
    { label: 'Cost / treatment started', value: formatPence(costPerStart), sub: 'Ad spend ÷ treatments started' },
    { label: 'Revenue / lead', value: formatPence(revPerLead), sub: 'Treatment value ÷ leads' },
  ];

  const channels = roi?.connected ? roi.by_provider : [];
  const lens = buildLens(practices, g.marginPct, roi);

  // Clinical revenue lines from Dentally invoice items (group-wide).
  const lines = data.revenueByLine ?? [];
  const costConnected = data.revenueLineCostBasis != null; // Xero/QuickBooks P&L feed present

  return (
    <div className="flex flex-col gap-4">
      {/* Headline funnel KPIs */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {funnel.map((k) => (
          <div key={k.label} className="card-padded">
            <div className="text-xs text-ink-muted uppercase tracking-wide">{k.label}</div>
            <div className="display text-2xl font-bold mt-1">{k.value}</div>
            <div className="text-xs text-ink-muted mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      {!isGroupScope && (
        <AlertRow tone="info" title="Funnel KPIs stay group-wide"
          body="Treatment plans and GHL leads aren't attributed per practice, so the four headline KPIs cover the whole group. The Business Performance table below narrows to the selected practice." />
      )}

      {/* Marketing Snapshot — per ad provider (GHL/ads). Revenue + ROAS are
          account-level only (not served per provider), so they show as —. */}
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="display text-lg font-semibold">Marketing Snapshot</h3>
            <p className="text-sm text-ink-muted mt-0.5">Spend, leads and conversions across your paid channels.</p>
          </div>
          {roi?.connected && roi.roas > 0 && <Chip colour="emerald">{roi.roas.toFixed(2)}× blended ROAS</Chip>}
        </div>
        {channels.length === 0 ? (
          <EmptyState message="No ad spend in this window. Connect Google Ads / Meta in Data Hub." />
        ) : (
          <div className="grid gap-3 mt-3 grid-cols-1 md:grid-cols-3">
            {channels.map((c) => (
              <div key={c.provider} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize">{c.provider}</span>
                  <span className="display text-2xl font-bold">{DASH}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                  <ChannelStat label="Spend" value={formatPence(c.spend_pence)} />
                  <ChannelStat label="Revenue" value={DASH} />
                  <ChannelStat label="Leads" value={formatNumber(c.leads)} />
                  <ChannelStat label="New pts" value={formatNumber(c.conversions)} />
                </div>
              </div>
            ))}
          </div>
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
function buildLens(rows: HubPractice[], marginPct: number, roi: ReturnType<typeof useMarketingRoi>['data']): Lens[] {
  if (!rows.length) return [];
  const out: Lens[] = [];

  const topRev = [...rows].sort((a, b) => b.revenuePence - a.revenuePence)[0];
  out.push({ tone: 'good', icon: <ArrowUpRight size={16} />, title: `${topRev.name} leads on turnover`, body: `${formatPence(topRev.revenuePence)} in the window — protect its diary and replicate the mix.` });

  const worstNoShow = [...rows].filter((p) => p.appointments > 0).sort((a, b) => b.noShowRate - a.noShowRate)[0];
  if (worstNoShow && worstNoShow.noShowRate > 0)
    out.push({ tone: 'warn', icon: <AlertTriangle size={16} />, title: `${worstNoShow.name} no-show rate ${worstNoShow.noShowRate}%`, body: `${formatNumber(worstNoShow.noShows)} missed appointments — reminders, deposits and speed-to-lead are the cheapest fix.` });

  if (roi?.connected && roi.by_provider.length > 0) {
    const top = [...roi.by_provider].sort((a, b) => a.cpl_pence - b.cpl_pence).find((p) => p.leads > 0);
    if (top)
      out.push({ tone: 'info', icon: <Gem size={16} />, title: `${top.provider} is your cheapest channel`, body: `${formatPence(top.cpl_pence)} per lead from ${formatPence(top.spend_pence)} spend — shift budget to the winner.` });
  }

  out.push({ tone: marginPct >= 18 ? 'good' : 'bad', icon: <TrendingDown size={16} />, title: marginPct > 0 ? `Group net margin ${marginPct}%` : 'No margin data yet', body: marginPct >= 18 ? 'Healthy against the ~18% dental benchmark.' : marginPct > 0 ? 'Below the ~18% benchmark — wage ratio and lab/materials are the usual leak.' : 'Connect Xero for live P&L margin.' });
  return out.slice(0, 4);
}
