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
import { BestPerformer, type Performer } from '@/features/marketing/_shared/BestPerformer';
import { computeDelta, type Delta } from '@/features/marketing/_shared/compare';

export interface ChannelTotals {
  spendPence: number;
  leads: number;
  booked: number;
  accepted: number;
  cpaPence: number | null;
  cplPence: number | null;
}

/** One grain of the hierarchy — campaign, ad set, ad group, ad, keyword,
 *  search term — and the row currently winning it. */
export interface Grain {
  label: string;
  /** Best by cost per conversion, or null when nothing in this grain
   *  converted. A card is not rendered for a null row: "nothing converted" is
   *  a fact the table below already shows, and repeating it in a highlight
   *  takes the eye first for no gain. */
  row: Performer | null;
  fallbackName: string;
  /** Shown when the grain has rows but none converted, so the card's absence
   *  is explained rather than looking like a loading failure. */
  note?: string | null;
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
  total, previous, campaigns, grains, comparisonLabel, onOpenCampaign, onOpenGrain,
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
  grains: Grain[];
  comparisonLabel: string | null;
  onOpenCampaign: (campaignId: string) => void;
  onOpenGrain: (href: string) => void;
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
      <div className="flex justify-end">
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

      {/* What is winning at each grain, and the way through to the table. A
          bare link told you nothing; the name of the best ad set at the cost
          it achieved is the decision. Ranked by cost per conversion — the same
          basis the report pages rank by, so the two cannot disagree about
          which row is best. */}
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-ink">Best performer at each level</p>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
          {grains.map((g) => (
            <BestPerformer
              key={g.href}
              label={g.label}
              row={g.row}
              fallbackName={g.fallbackName}
              note={g.note ?? null}
              onOpen={() => onOpenGrain(g.href)}
            />
          ))}
        </div>
        {grains.every((g) => !g.row) && (
          <p className="text-[12.5px] text-ink-muted">
            Nothing converted in this period, so there is no best performer to name yet.
          </p>
        )}
      </div>
    </div>
  );
}
