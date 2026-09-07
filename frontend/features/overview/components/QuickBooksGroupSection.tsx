'use client';
// ============================================================================
// Business Hub — QuickBooks.
//
// ONE block for the group's accounting figures, laid out as a statement:
// revenue less running costs equals net profit, in that order, so the panel
// visibly adds up instead of asserting three numbers side by side and hoping
// they agree.
//
// It replaces two blocks that did not agree with each other. A card grid above
// showed "Group Profit"/"Margin" from the Business Hub feed over the GLOBAL
// scope window, while this section showed revenue and profit from
// /api/finance/quickbooks over its OWN period dropdown — two windows and two
// definitions of profit, stacked. The company filter compounded it: it was
// wired only to the lower block, so choosing a company moved half the section
// and left "Group Profit" where it was.
//
// The window now follows the page's scope bar, resolved through
// londonMonthWindow(). Two things that resolution must not do quietly:
//   * Slice the ISO instant. Bounds are London wall-clock midnight in UTC, so
//     under BST 1 Aug arrives as 2026-07-31T23:00Z and `.slice(0,7)` reads July.
//   * Round a part-month selection without saying so. QuickBooks has no grain
//     finer than a month, so 1-15 Aug can only be answered with all of August,
//     and the block says exactly that rather than presenting a full month's
//     figures under a fortnight's heading.
// ============================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { ChevronRight } from 'lucide-react';
import { Card, Chip, type ChipColour } from '@/components/ui';
import { SectionFilterPills, PillRow, Pill } from '@/features/_shared/SectionFilterPills';
import { HeadlineCard, SectionLabel, type HeadlineKpi } from './HeadlineCard';
import type { Polarity } from '@/features/marketing/_shared/compare';
import { DeltaBadge } from '@/features/marketing/_shared/DeltaBadge';
import { computeDelta } from '@/features/marketing/_shared/compare';
import { useScopePeriod, londonMonthWindow } from '@/features/_shared/scope-context';
import { getQuickBooksOverview, type QbMethod } from '@/features/finance/quickbooks-api';

const DASH = '—';

// Straight from the theme (tailwind.config: brand / danger). The greens and
// reds used here before were stock Tailwind hexes that belong to no token in
// this design system, so money read in a different green from every other
// accent on the page.
const POSITIVE = '#1D6E5F'; // brand
const NEGATIVE = '#C25F4D'; // danger
const BAR_REVENUE = '#9FCBBC'; // brand-200
const GRID = '#DCE4DF'; // border

// -£19,466, never "£-19,466". A bank balance and a loss-making company both
// go negative here, and the sign belongs in front of the amount.
const gbp = (pence: number) => {
  const n = Math.round((pence || 0) / 100);
  return `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB')}`;
};

// Net margin as a number, for tone thresholds. Zero revenue -> 0, and the
// caller must not render a chip at all in that case (see marginOf).
const marginPct = (s: { netProfitPence: number; revenuePence: number }): number =>
  s.revenuePence > 0 ? (s.netProfitPence / s.revenuePence) * 100 : 0;

// A margin needs a denominator. Zero revenue makes it unknowable, not 0%.
const marginOf = (netPence: number, revPence: number): string =>
  revPence > 0 ? `${(Math.round((netPence / revPence) * 1000) / 10).toFixed(1)}%` : DASH;

// 'YYYY-MM' -> 'Aug 2026'.
function fmtMonth(ym: string): string {
  const [y, m] = (ym || '').split('-').map(Number);
  if (!y || !m) return ym || '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// 'Aug 2026', or 'Oct 2025 – Sep 2026' when the window spans months.
function fmtSpan(fromPeriod: string, toPeriod: string): string {
  return fromPeriod === toPeriod ? fmtMonth(fromPeriod) : `${fmtMonth(fromPeriod)} – ${fmtMonth(toPeriod)}`;
}

// The seven non-revenue buckets, in the order an operator reads a P&L: the
// people first, then what they use, then what it costs to keep the doors open.
const COST_BUCKETS: { key: keyof QbByBucket; label: string }[] = [
  { key: 'associates', label: 'Associates' },
  { key: 'staff', label: 'Staff' },
  { key: 'lab', label: 'Lab' },
  { key: 'materials', label: 'Materials' },
  { key: 'overhead', label: 'Overhead' },
  { key: 'tax', label: 'Tax' },
  { key: 'other', label: 'Other' },
];
type QbByBucket = {
  revenue: number; associates: number; staff: number; lab: number; materials: number;
  overhead: number; tax: number; other: number;
};

export function QuickBooksGroupSection({
  compare = null,
}: {
  /** The page's own comparison window, so this section measures across exactly
   *  the same bounds as the Dentally, Marketing and GoHighLevel sections. */
  compare?: { previous: { since: string; until: string; label: string } } | null;
} = {}) {
  const { win } = useScopePeriod();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [method, setMethod] = useState<QbMethod>('accrual');
  const [costsOpen, setCostsOpen] = useState(false);

  // The scope bar's instants -> the London months QuickBooks can actually answer.
  const { since, until } = win;
  const { fromPeriod, toPeriod, widened } = useMemo(() => londonMonthWindow({ since, until }), [since, until]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['qbo-finance', 'hub', accountId ?? 'all', method, fromPeriod, toPeriod],
    queryFn: () => getQuickBooksOverview({
      accountId: accountId ?? undefined,
      // Sent as day bounds; the backend windows monthly_financials by month.
      from: `${fromPeriod}-01`,
      to: `${toPeriod}-01`,
      method,
    }),
  });

  // The comparison window, resolved to months the same way — a second call to
  // the SAME endpoint, so the prior figure cannot drift from the one it is
  // measured against because it IS that figure asked for a different month.
  const prev = compare
    ? londonMonthWindow({ since: compare.previous.since, until: compare.previous.until })
    : null;
  const { data: was } = useQuery({
    queryKey: ['qbo-finance', 'hub-prev', accountId ?? 'all', method, prev?.fromPeriod, prev?.toPeriod],
    queryFn: () => getQuickBooksOverview({
      accountId: accountId ?? undefined,
      from: `${prev!.fromPeriod}-01`,
      to: `${prev!.toPeriod}-01`,
      method,
    }),
    enabled: !!prev,
  });

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const options = useMemo(() => accounts.map((a) => ({ id: a.id, label: a.companyName })), [accounts]);

  // A failed read must say so. Rendering null here is what let a broken request
  // on the Facebook panel look like a page that was simply designed without
  // cards — silence and "nothing to show" are indistinguishable to the reader.
  if (error) {
    return (
      <Card>
        <SectionLabel>QuickBooks</SectionLabel>
        <p className="text-sm" style={{ color: NEGATIVE }}>
          Could not load QuickBooks: {(error as Error).message}
        </p>
      </Card>
    );
  }
  if (isLoading && !data) {
    return (
      <Card>
        <SectionLabel>QuickBooks</SectionLabel>
        <p className="text-sm text-ink-muted">Loading…</p>
      </Card>
    );
  }
  // No company connected — the block has nothing to be about.
  if (!data || accounts.length === 0) return null;

  const s = data.summary;
  const b = data.byBucket as QbByBucket;
  const span = fmtSpan(data.window.fromPeriod, data.window.toPeriod);
  const costBuckets = COST_BUCKETS
    .map((c) => ({ ...c, pence: b?.[c.key] ?? 0 }))
    .filter((c) => c.pence !== 0)
    .sort((x, y) => y.pence - x.pence);

  // The prior summary. Null until BOTH reads have landed, so a card shows no
  // comparison rather than one measured against half a period.
  const p = compare && was ? was.summary : null;
  const delta = (
    current: number | null, previous: number | null,
    polarity: Polarity, format: (n: number) => string,
  ) => (p && compare
    ? <DeltaBadge
        delta={computeDelta(current, previous, polarity)}
        previousLabel={previous == null ? DASH : `${format(previous)} · ${compare.previous.label}`} />
    : null);

  const trend = (data.trend ?? []).map((t) => ({
    period: fmtMonth(t.period).replace(' ', ' '),
    Revenue: Math.round(t.revenuePence / 100),
    Profit: Math.round(t.netProfitPence / 100),
  }));

  return (
    <Card>
      <SectionLabel>QuickBooks</SectionLabel>

      <p className="text-xs text-ink-muted mb-3">
        {span} · {accounts.length} connected {accounts.length === 1 ? 'company' : 'companies'}
        {widened && <> · whole {data.window.fromPeriod === data.window.toPeriod ? 'month' : 'months'} — QuickBooks reports monthly, so it cannot answer a part-month window</>}
      </p>

      <SectionFilterPills label="Company" options={options}
        selectedId={accountId} onSelect={setAccountId} allLabel="All companies" />
      <PillRow label="Basis">
        {(['accrual', 'cash'] as QbMethod[]).map((m) => (
          <Pill key={m} active={method === m} onClick={() => setMethod(m)}>
            {m === 'accrual' ? 'Accrual' : 'Cash'}
          </Pill>
        ))}
      </PillRow>

      {/* ── The statement. Three lines that add up, in that order. ─────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <StatementRow label="Revenue" value={gbp(s.revenuePence)}
          delta={delta(s.revenuePence, p?.revenuePence ?? null, 'higher-better', gbp)} />
        <StatementRow
          label="Less running costs"
          value={gbp(s.expensesPence)}
          onClick={costBuckets.length ? () => setCostsOpen((v) => !v) : undefined}
          open={costsOpen}
          hint={costBuckets.length ? `${costBuckets.length} categories` : undefined}
          // NEUTRAL, deliberately. Costs rising alongside rising revenue is not
          // bad news, and costs falling because the practice did less work is
          // not good news — the judgement lives in the margin below, which has
          // both sides of it. Colouring this line would assert one the number
          // cannot support on its own.
          delta={delta(s.expensesPence, p?.expensesPence ?? null, 'neutral', gbp)}
        />
        {costsOpen && (
          <div className="bg-[#FAFAFA] border-t border-border px-4 py-2">
            {costBuckets.map((c) => (
              <div key={c.key} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-ink-muted pl-5">{c.label}</span>
                <span className="tabular-nums tracking-tight">{gbp(c.pence)}</span>
              </div>
            ))}
            {/* The categories are the costs — if they ever stop summing to the
                line above, the panel is claiming an arithmetic it does not do. */}
            <div className="flex items-center justify-between py-1.5 text-sm border-t border-border mt-1 pt-2">
              <span className="text-ink-muted pl-5">Total</span>
              <span className="tabular-nums tracking-tight font-semibold">
                {gbp(costBuckets.reduce((n, c) => n + c.pence, 0))}
              </span>
            </div>
          </div>
        )}
        <StatementRow
          label="Net profit"
          value={gbp(s.netProfitPence)}
          chip={s.revenuePence > 0
            ? { text: `${marginOf(s.netProfitPence, s.revenuePence)} margin`,
                tone: s.netProfitPence < 0 ? 'rose' : marginPct(s) >= 18 ? 'emerald' : 'amber' }
            : null}
          tone={s.netProfitPence >= 0 ? 'good' : 'bad'}
          delta={delta(s.netProfitPence, p?.netProfitPence ?? null, 'higher-better', gbp)}
          total
        />
      </div>

      {/* ── Position. Point-in-time, NOT the window — said on its face, because
             a balance sitting beside windowed figures reads as windowed. ──── */}
      <div className="mt-4">
        <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">Position</div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          <HeadlineCard c={{
            label: 'Cash at bank',
            value: gbp(s.cashAtBankPence),
            sub: s.cashAsOf && s.cashAsOf !== 'latest'
              ? `Month-end balance · ${fmtMonth(s.cashAsOf)}`
              : 'Latest synced balance — no month-end history yet',
            // Compared ONLY when both windows resolved a real month-end
            // snapshot. Without history both fall back to the same live
            // balance, and the card would render a confident "flat 0%" that is
            // an artefact of asking the same question twice.
            compare: compare && p && s.cashAsOf !== 'latest' && p.cashAsOf !== 'latest' ? {
              current: s.cashAtBankPence, previous: p.cashAtBankPence,
              polarity: 'higher-better' as Polarity, isRate: false,
              format: (n: number) => `${gbp(n)} · ${compare.previous.label}`,
            } : undefined,
            // A negative balance is an overdrawn account, not a rounding
            // artefact, so it is chipped rather than left to the reader.
            chip: s.cashAtBankPence < 0 ? { text: 'Overdrawn', tone: 'rose' } : null,
            source: 'QuickBooks bank accounts. A point-in-time balance, not a figure for the selected window.',
          }} />
          <HeadlineCard c={{
            label: 'Outstanding debtors',
            value: gbp(s.receivablesPence),
            // Point-in-time and NOT windowed: the same unpaid invoices are
            // returned whatever period is asked for, so there is no prior to
            // compare against. A delta here would always read "flat 0%".
            sub: 'Unpaid invoices, as they stand today — not windowed',
            chip: null,
            source: 'Unpaid QuickBooks invoices across the selected companies. Point-in-time, not windowed.',
          }} />
        </div>
      </div>

      {/* ── Trend. Revenue against profit, so a month that grew turnover while
             losing money cannot hide inside a single rising bar. ──────────── */}
      {trend.length > 1 && (
        <div className="mt-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">Revenue and profit by month (£)</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} width={52} />
                <Tooltip formatter={(v: number) => `£${Number(v).toLocaleString('en-GB')}`} />
                {/* A loss-making month sits below this line — visible, not implied. */}
                <ReferenceLine y={0} stroke={GRID} />
                <Bar dataKey="Revenue" fill={BAR_REVENUE} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Profit" fill={POSITIVE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── By company. Only in the summed view: with one company selected the
             table would be a single row restating the statement above. ────── */}
      {data.companies.length > 1 && (
        <div className="mt-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">By company</div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="right">Revenue</th>
                  <th className="right">Costs</th>
                  <th className="right">Net profit</th>
                  <th className="right">Margin</th>
                  <th className="right">Cash</th>
                  <th className="right">Debtors</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((c) => (
                  <tr key={c.accountId}>
                    <td><strong>{c.companyName}</strong></td>
                    <td className="right tabular-nums">{gbp(c.revenuePence)}</td>
                    <td className="right tabular-nums">{gbp(c.expensesPence)}</td>
                    <td className="right tabular-nums" style={{ color: c.netProfitPence >= 0 ? POSITIVE : NEGATIVE }}>
                      {gbp(c.netProfitPence)}
                    </td>
                    <td className="right tabular-nums">{marginOf(c.netProfitPence, c.revenuePence)}</td>
                    <td className="right tabular-nums">{gbp(c.cashAtBankPence)}</td>
                    <td className="right tabular-nums">{gbp(c.receivablesPence)}</td>
                  </tr>
                ))}
                {/* The footer is the headline. If the two ever disagree, the
                    table is not a breakdown of anything. */}
                <tr style={{ borderTop: '2px solid var(--border, #E5E7EB)' }}>
                  <td><strong>Group</strong></td>
                  <td className="right tabular-nums"><strong>{gbp(s.revenuePence)}</strong></td>
                  <td className="right tabular-nums"><strong>{gbp(s.expensesPence)}</strong></td>
                  <td className="right tabular-nums"><strong>{gbp(s.netProfitPence)}</strong></td>
                  <td className="right tabular-nums"><strong>{marginOf(s.netProfitPence, s.revenuePence)}</strong></td>
                  <td className="right tabular-nums"><strong>{gbp(s.cashAtBankPence)}</strong></td>
                  <td className="right tabular-nums"><strong>{gbp(s.receivablesPence)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-muted mt-3">
        {method === 'accrual' ? 'Accrual basis' : 'Cash basis'} · QuickBooks companies are held at group level, so the
        practice filter above does not narrow these figures.
      </p>
    </Card>
  );
}


function StatementRow({
  label, value, chip, tone, total, onClick, open, hint, delta,
}: {
  label: string; value: string; chip?: { text: string; tone: ChipColour } | null;
  tone?: 'good' | 'bad'; total?: boolean;
  onClick?: () => void; open?: boolean; hint?: string;
  /** The period comparison, rendered under the figure. */
  delta?: React.ReactNode;
}) {
  const colour = tone === 'good' ? POSITIVE : tone === 'bad' ? NEGATIVE : undefined;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick, 'aria-expanded': !!open } : {})}
      className={`w-full text-left flex items-center justify-between gap-3 px-4 ${total ? 'py-3.5' : 'py-3'} ${
        total ? 'border-t-2 border-ink bg-[#FAFAFA]' : 'border-b border-border'
      } ${onClick ? 'transition-colors hover:bg-[#FAFAFA]' : ''}`}
    >
      {/* Same label treatment as every headline tile on this page: small, muted,
          uppercase, tracked — not a heading in the serif display face. */}
      <span className="flex items-center gap-1.5 text-xs text-ink-muted uppercase tracking-wide">
        {onClick && (
          <ChevronRight size={14} className="shrink-0"
            style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }} />
        )}
        {label}
        {hint && <span className="normal-case tracking-normal text-ink-muted/80">· {hint}</span>}
      </span>
      <span className="flex items-center gap-2.5">
        {chip && <Chip colour={chip.tone}>{chip.text}</Chip>}
        <span className="text-right">
          {/* tabular-nums + tracking-tight, matching HeadlineCard. The serif
              `.display` face used here before was the only place on the page a
              figure was not set in the tile typeface. */}
          <span
            className={`block tabular-nums tracking-tight font-bold ${total ? 'text-2xl' : 'text-xl'}`}
            style={colour ? { color: colour } : undefined}
          >
            {value}
          </span>
          {delta}
        </span>
      </span>
    </Wrapper>
  );
}
