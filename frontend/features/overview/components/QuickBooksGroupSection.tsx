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
import { Card } from '@/components/ui';
import { SectionFilterPills } from '@/features/_shared/SectionFilterPills';
import { useScopePeriod, londonMonthWindow } from '@/features/_shared/scope-context';
import { getQuickBooksOverview, type QbMethod } from '@/features/finance/quickbooks-api';

const DASH = '—';

const gbp = (pence: number) => '£' + Math.round((pence || 0) / 100).toLocaleString('en-GB');

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

export function QuickBooksGroupSection() {
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

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const options = useMemo(() => accounts.map((a) => ({ id: a.id, label: a.companyName })), [accounts]);

  // A failed read must say so. Rendering null here is what let a broken request
  // on the Facebook panel look like a page that was simply designed without
  // cards — silence and "nothing to show" are indistinguishable to the reader.
  if (error) {
    return (
      <Card>
        <SectionLabel>QuickBooks</SectionLabel>
        <p className="text-sm" style={{ color: '#B91C1C' }}>
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

  const trend = (data.trend ?? []).map((t) => ({
    period: fmtMonth(t.period).replace(' ', ' '),
    Revenue: Math.round(t.revenuePence / 100),
    Profit: Math.round(t.netProfitPence / 100),
  }));

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <SectionLabel>QuickBooks</SectionLabel>
          <p className="text-sm text-ink-muted -mt-1">
            {span} · {accounts.length} connected {accounts.length === 1 ? 'company' : 'companies'}
            {widened && <> · whole {data.window.fromPeriod === data.window.toPeriod ? 'month' : 'months'} — QuickBooks reports monthly, so it cannot answer a part-month window</>}
          </p>
        </div>
        <BasisToggle value={method} onChange={setMethod} />
      </div>

      <div className="mt-3">
        <SectionFilterPills label="Company" options={options}
          selectedId={accountId} onSelect={setAccountId} allLabel="All companies" />
      </div>

      {/* ── The statement. Three lines that add up, in that order. ─────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <StatementRow label="Revenue" value={gbp(s.revenuePence)} />
        <StatementRow
          label="Less running costs"
          value={gbp(s.expensesPence)}
          onClick={costBuckets.length ? () => setCostsOpen((v) => !v) : undefined}
          open={costsOpen}
          hint={costBuckets.length ? `${costBuckets.length} categories` : undefined}
        />
        {costsOpen && (
          <div className="bg-[#FAFAFA] border-t border-border px-4 py-2">
            {costBuckets.map((c) => (
              <div key={c.key} className="flex items-center justify-between py-1 text-sm">
                <span className="text-ink-muted pl-4">{c.label}</span>
                <span className="tabular-nums">{gbp(c.pence)}</span>
              </div>
            ))}
            {/* The categories are the costs — if they ever stop summing to the
                line above, the panel is claiming an arithmetic it does not do. */}
            <div className="flex items-center justify-between py-1 text-sm border-t border-border mt-1 pt-1.5">
              <span className="text-ink-muted pl-4">Total</span>
              <span className="tabular-nums font-semibold">
                {gbp(costBuckets.reduce((n, c) => n + c.pence, 0))}
              </span>
            </div>
          </div>
        )}
        <StatementRow
          label="= Net profit"
          value={gbp(s.netProfitPence)}
          note={`${marginOf(s.netProfitPence, s.revenuePence)} margin`}
          tone={s.netProfitPence >= 0 ? 'good' : 'bad'}
          total
        />
      </div>

      {/* ── Position. Point-in-time, NOT the window — said on its face, because
             a balance sitting beside windowed figures reads as windowed. ──── */}
      <div className="mt-4">
        <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">Position</div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <PositionTile
            label="Cash at bank"
            value={gbp(s.cashAtBankPence)}
            sub={s.cashAsOf && s.cashAsOf !== 'latest'
              ? `Month-end balance, ${fmtMonth(s.cashAsOf)}`
              : 'Latest synced balance — no month-end history for this window yet'}
          />
          <PositionTile
            label="Outstanding debtors"
            value={gbp(s.receivablesPence)}
            sub="Unpaid QuickBooks invoices, as they stand today"
          />
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEE" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `£${Math.round(v / 1000)}k`} width={52} />
                <Tooltip formatter={(v: number) => `£${Number(v).toLocaleString('en-GB')}`} />
                {/* A loss-making month sits below this line — visible, not implied. */}
                <ReferenceLine y={0} stroke="#CBD5E1" />
                <Bar dataKey="Revenue" fill="#CBD5E1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Profit" fill="#047857" radius={[3, 3, 0, 0]} />
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
                    <td className="right tabular-nums" style={{ color: c.netProfitPence >= 0 ? '#047857' : '#B91C1C' }}>
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

function SectionLabel({ children }: { children: string }) {
  return <h3 className="display text-lg font-semibold mb-2">{children}</h3>;
}

// Accrual vs cash is not a display preference — QuickBooks syncs a full P&L
// under each, and the same window legitimately reports two different profits.
// The chosen basis is named on the block rather than assumed.
function BasisToggle({ value, onChange }: { value: QbMethod; onChange: (m: QbMethod) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="group" aria-label="Accounting basis">
      {(['accrual', 'cash'] as QbMethod[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={`px-3 py-1.5 capitalize ${value === m ? 'bg-ink text-white' : 'bg-white text-ink-muted hover:bg-[#F5F5F5]'}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function StatementRow({
  label, value, note, tone, total, onClick, open, hint,
}: {
  label: string; value: string; note?: string;
  tone?: 'good' | 'bad'; total?: boolean;
  onClick?: () => void; open?: boolean; hint?: string;
}) {
  const colour = tone === 'good' ? '#047857' : tone === 'bad' ? '#B91C1C' : undefined;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick, 'aria-expanded': !!open } : {})}
      className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 ${
        total ? 'border-t-2 border-ink bg-[#FAFAFA]' : 'border-b border-border'
      } ${onClick ? 'hover:bg-[#FAFAFA]' : ''}`}
    >
      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
        {onClick && (
          <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }} />
        )}
        {label}
        {hint && <span className="text-xs text-ink-muted">· {hint}</span>}
      </span>
      <span className="flex items-baseline gap-2">
        {note && <span className="text-xs text-ink-muted">{note}</span>}
        <span
          className={`display tabular-nums ${total ? 'text-2xl font-bold' : 'text-xl font-semibold'}`}
          style={colour ? { color: colour } : undefined}
        >
          {value}
        </span>
      </span>
    </Wrapper>
  );
}

function PositionTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="display text-2xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-ink-muted mt-1">{sub}</div>
    </div>
  );
}
