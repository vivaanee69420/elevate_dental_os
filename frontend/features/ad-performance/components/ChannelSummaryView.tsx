'use client';
// One channel's decision summary: the figures worth acting on, the shape of the
// spend, and a way through to the detail.
//
// NOT the report page. The report pages exist to answer "which ad set, which
// keyword" and they carry the tables for it. This page answers the question
// before that one — is this channel working, where is the money going, what
// changed since last period — and then hands over. Reproducing their tables
// here made one long page that answered neither question well.
//
// Presentational on purpose: it takes rows and renders them. The two channels
// pass their own hooks' output in, so there is ONE layout with two adapters
// rather than two layouts free to drift into different-looking answers to the
// same question.

import Link from 'next/link';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { formatPence } from '@/lib/format';
import { EmptyState, Skeleton } from '@/components/ui';
import { StatRail } from '@/features/marketing/_shared/StatRail';
import { DeltaInline } from '@/features/marketing/_shared/DeltaBadge';
import { CampaignHighlights, type HighlightCampaign } from '@/features/marketing/_shared/CampaignHighlights';
import { computeDelta, type Delta } from '@/features/marketing/_shared/compare';

export interface ChannelTotals {
  spendPence: number;
  leads: number;
  booked: number;
  accepted: number;
  cpaPence: number | null;
  cplPence: number | null;
}

export interface TierLink {
  label: string;
  /** What this grain answers, in one line. Never a fabricated count. */
  hint: string;
  href: string;
}

const nf = new Intl.NumberFormat('en-GB');
const SLICE_COLOURS = ['#1F7A63', '#2F9E7E', '#5FBFA3', '#96D8C4', '#C6E9DE', '#DCE5E2'];
const TOP_SLICES = 5;

/** Spend by campaign, largest first, with the tail folded into one slice.
 *  Twenty legend entries is not a chart, it is a table drawn badly. */
function spendSlices(campaigns: { campaignName: string | null; campaignId: string | null; spendPence: number }[]) {
  const rows = (campaigns ?? [])
    .filter((c) => c.spendPence > 0)
    .sort((a, b) => b.spendPence - a.spendPence);
  const top = rows.slice(0, TOP_SLICES).map((c) => ({
    name: c.campaignName ?? c.campaignId ?? 'Unnamed campaign',
    value: c.spendPence,
  }));
  const restPence = rows.slice(TOP_SLICES).reduce((a, c) => a + c.spendPence, 0);
  if (restPence > 0) {
    top.push({ name: `${rows.length - TOP_SLICES} more campaigns`, value: restPence });
  }
  return top;
}

function SliceTooltip({ active, payload, total }: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number } }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const share = total > 0 ? ((p.value / total) * 100).toFixed(1) : '0.0';
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] shadow-sm">
      <div className="font-medium text-ink">{p.name}</div>
      <div className="text-ink-muted">{formatPence(p.value)} · {share}% of spend</div>
    </div>
  );
}

/** Leads -> booked -> patients. A funnel is three numbers whose meaning is the
 *  drop between them, which a bar shows and three separate cards do not. */
function FunnelChart({ total }: { total: ChannelTotals }) {
  const data = [
    { stage: 'Leads', value: total.leads },
    { stage: 'Booked', value: total.booked },
    { stage: 'Patients', value: total.accepted },
  ];
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--ink-muted)" />
        <YAxis type="category" dataKey="stage" width={64} tick={{ fontSize: 12 }} stroke="var(--ink-muted)" />
        <Tooltip
          cursor={{ fill: 'var(--bg)' }}
          formatter={(v: number) => [nf.format(v), '']}
          contentStyle={{ fontSize: 12.5, borderRadius: 8, border: '1px solid var(--border)' }}
        />
        <Bar dataKey="value" fill="#2F9E7E" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChannelSummaryView({
  title, reportHref, isPending, error, notConnected,
  total, previous, campaigns, tiers, comparisonLabel, onOpenCampaign,
}: {
  title: string;
  reportHref: string;
  isPending: boolean;
  error: Error | null;
  /** A channel with no connection renders one honest line, not a wall of £0. */
  notConnected: string | null;
  total: ChannelTotals | null;
  /** Null when comparison is off — the arrows then simply do not render. */
  previous: ChannelTotals | null;
  campaigns: HighlightCampaign[];
  tiers: TierLink[];
  comparisonLabel: string | null;
  onOpenCampaign: (campaignId: string) => void;
}) {
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (error) return <EmptyState message={`${title}: ${error.message}`} />;
  if (notConnected) return <EmptyState message={notConnected} />;
  if (!total) return <EmptyState message={`No ${title} data for this period.`} />;

  const slices = spendSlices(campaigns.map((c) => ({
    campaignId: c.campaignId, campaignName: c.campaignName, spendPence: c.spendPence,
  })));
  const sliceTotal = slices.reduce((a, s) => a + s.value, 0);

  // Polarity matters more than direction: spend rising is neutral, cost per
  // patient rising is bad, patients rising is good. An arrow coloured by
  // direction alone would praise a channel for getting more expensive.
  const d = (pick: (t: ChannelTotals) => number | null, polarity: Parameters<typeof computeDelta>[2]): Delta | null =>
    previous ? computeDelta(pick(total), pick(previous), polarity) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[17px] font-semibold text-ink">{title}</h3>
        <Link href={reportHref} className="text-[12.5px] font-medium text-brand hover:underline">
          Open the full {title} report →
        </Link>
      </div>

      <StatRail
        stats={[
          {
            label: 'Spend', value: formatPence(total.spendPence), accent: true,
            sub: comparisonLabel ?? undefined,
            badge: <DeltaInline delta={d((t) => t.spendPence, 'neutral')} />,
          },
          {
            label: 'Leads', value: nf.format(total.leads),
            badge: <DeltaInline delta={d((t) => t.leads, 'higher-better')} />,
          },
          {
            label: 'Booked', value: nf.format(total.booked),
            badge: <DeltaInline delta={d((t) => t.booked, 'higher-better')} />,
          },
          {
            label: 'Patients', value: nf.format(total.accepted),
            badge: <DeltaInline delta={d((t) => t.accepted, 'higher-better')} />,
          },
          {
            // Null, never £0: a cost per no patients is unknowable, not free.
            label: 'Cost per patient',
            value: total.cpaPence === null ? '—' : formatPence(total.cpaPence),
            sub: total.cpaPence === null ? 'No patients yet' : undefined,
            badge: <DeltaInline delta={d((t) => t.cpaPence, 'lower-better')} />,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-surface p-4">
          <p className="mb-1 text-[12.5px] font-medium text-ink">Where the spend went</p>
          <p className="mb-2 text-[11.5px] text-ink-muted">
            Top {TOP_SLICES} campaigns by spend; the rest are grouped.
          </p>
          {sliceTotal === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-ink-muted">No spend in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={44} outerRadius={72} paddingAngle={1}>
                  {slices.map((_, i) => (
                    <Cell key={i} fill={SLICE_COLOURS[i % SLICE_COLOURS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<SliceTooltip total={sliceTotal} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {slices.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {slices.map((sl, i) => (
                <li key={sl.name} className="flex items-center gap-2 text-[11.5px]">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }}
                  />
                  <span className="truncate text-ink-muted">{sl.name}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink">{formatPence(sl.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-panel border border-border bg-surface p-4">
          <p className="mb-1 text-[12.5px] font-medium text-ink">Lead to patient</p>
          <p className="mb-2 text-[11.5px] text-ink-muted">
            The drop between these three is where the money is won or lost.
          </p>
          <FunnelChart total={total} />
        </div>
      </div>

      {/* The two campaigns worth a decision this period. Clicking opens that
          campaign's leads on the full report rather than a dead end here. */}
      <CampaignHighlights campaigns={campaigns} onOpenCampaign={onOpenCampaign} />

      {/* The way through to the detail. These carry no numbers deliberately:
          a count here would need the deep tables this page exists NOT to load,
          and an invented one is worse than an honest label. */}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {tiers.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group rounded-panel border border-border bg-surface px-4 py-3 transition-colors hover:border-brand-200 hover:bg-brand-50/30"
          >
            <p className="text-[13px] font-medium text-ink">{t.label}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">{t.hint}</p>
            <p className="mt-1.5 text-[11.5px] text-brand opacity-0 transition-opacity group-hover:opacity-100">
              Open →
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
