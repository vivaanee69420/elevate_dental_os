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

import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { formatPence } from '@/lib/format';
import { EmptyState, Skeleton } from '@/components/ui';
import { HeadlineCard, SectionLabel, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import { CampaignHighlights, type HighlightCampaign } from '@/features/marketing/_shared/CampaignHighlights';
import { BestPerformer, type Performer } from '@/features/marketing/_shared/BestPerformer';
import type { Polarity } from '@/features/marketing/_shared/compare';

export interface ChannelTotals {
  spendPence: number;
  leads: number;
  booked: number;
  accepted: number;
  /** All three are null, never 0, when their denominator is zero: a cost per
   *  nothing is unknowable rather than free. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
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
  title, campaignsHref, isPending, error, notConnected,
  total, previous, campaigns, grains, previousLabel, onOpenCampaign, onOpenGrain,
}: {
  title: string;
  /** Where each card's figure breaks down — the campaigns tab of this
   *  channel's full report. Every one of these five splits by campaign, so
   *  they share a destination rather than inventing five. */
  campaignsHref: string;
  isPending: boolean;
  error: Error | null;
  /** A channel with no connection renders one honest line, not a wall of £0. */
  notConnected: string | null;
  total: ChannelTotals | null;
  /** The SAME window one period earlier, always fetched. There is no compare
   *  button: a figure without a direction is half an answer, and a control the
   *  reader has to find first means most never see the direction at all. */
  previous: ChannelTotals | null;
  campaigns: HighlightCampaign[];
  grains: Grain[];
  /** Names the period being compared against, e.g. "1-31 Aug 2026". Shown
   *  once per card beside the previous value, so the percentage is checkable
   *  rather than taken on trust. */
  previousLabel: string;
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

  // The Business Hub's own card, not a second one. It already separates arrow
  // DIRECTION from colour POLARITY (a rising cost per patient is a red
  // up-arrow), renders an unknowable delta as "no comparison" rather than 0%,
  // and says "new" instead of an infinite percentage against a zero base. A
  // second implementation would be a second set of those judgements, free to
  // drift from the cards the owner already reads every day.
  const cmp = (
    current: number | null, previous_: number | null,
    polarity: Polarity, format: (n: number) => string,
  ): HeadlineKpi['compare'] => (previous ? {
    current, previous: previous_, polarity,
    // The value only. The window it belongs to is named once above the row
    // rather than repeated on every card, which is four copies of one fact.
    format: (n) => format(n),
  } : undefined);

  const money = (n: number) => formatPence(n);
  const count = (n: number) => nf.format(n);

  // An em dash, never £0. A cost per nothing is unknowable, and a zero there
  // would read as the cheapest possible result rather than the absence of one.
  const perTag = (pence: number | null, unit: string) =>
    (pence === null ? null : { text: `${formatPence(pence)} ${unit}`, tone: 'emerald' as const });

  // The cost rides on the card whose figure it prices — cost per lead under
  // Leads, per booking under Booked, per patient under Patients — so the number
  // and what it cost are read together rather than in two places. The
  // conversion moves into the sub-line, which is where a denominator belongs.
  const cards: HeadlineKpi[] = [
    {
      label: 'Spend', value: formatPence(total.spendPence), sub: 'Ad spend',
      chip: null,
      compare: cmp(total.spendPence, previous?.spendPence ?? null, 'neutral', money),
      href: campaignsHref,
    },
    {
      label: 'Leads', value: nf.format(total.leads),
      sub: 'Attributed enquiries',
      chip: perTag(total.cplPence, 'per lead'),
      compare: cmp(total.leads, previous?.leads ?? null, 'higher-better', count),
      href: campaignsHref,
    },
    {
      label: 'Booked', value: nf.format(total.booked),
      sub: total.leads > 0 ? `${((total.booked / total.leads) * 100).toFixed(1)}% of leads` : 'Appointments booked',
      chip: perTag(total.cpbPence, 'per booking'),
      compare: cmp(total.booked, previous?.booked ?? null, 'higher-better', count),
      href: campaignsHref,
    },
    {
      label: 'Patients', value: nf.format(total.accepted),
      sub: total.booked > 0 ? `${((total.accepted / total.booked) * 100).toFixed(1)}% of booked` : 'Acquired',
      chip: perTag(total.cpaPence, 'per patient'),
      compare: cmp(total.accepted, previous?.accepted ?? null, 'higher-better', count),
      href: campaignsHref,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {previous && (
        <p className="-mb-1 text-[11.5px] text-ink-muted">
          Compared with {previousLabel}
        </p>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {cards.map((c) => <HeadlineCard key={c.label} c={c} />)}
      </div>

      {/* The winners come BEFORE the charts. A name and a cost is a decision;
          a chart is context for it, and context read first is just decoration. */}
      <div>
        <SectionLabel>Best performer at each level</SectionLabel>
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

      {/* The two campaigns worth a decision this period. */}
      <CampaignHighlights campaigns={campaigns} onOpenCampaign={onOpenCampaign} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-surface p-4 transition-colors hover:border-brand-200">
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

        <div className="rounded-panel border border-border bg-surface p-4 transition-colors hover:border-brand-200">
          <p className="mb-1 text-[12.5px] font-medium text-ink">Lead to patient</p>
          <p className="mb-2 text-[11.5px] text-ink-muted">
            The drop between these three is where the money is won or lost.
          </p>
          <FunnelChart total={total} />
        </div>
      </div>

    </div>
  );
}
