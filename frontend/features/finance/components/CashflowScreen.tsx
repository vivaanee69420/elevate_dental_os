'use client';
// Cash Flow & Runway. Two layers, both honest about provenance:
//   • OUTLOOK (GET /api/analytics/cashflow-outlook) — month-by-month cash in
//     (real settled receipts) vs cash out (P&L cost base, flagged), a
//     forward-projected closing-balance trail anchored to today's real bank
//     balance, corp-tax bills to plan for (estimate), and a free-cash decision.
//   • WEEKLY (GET /api/analytics/cashflow) — the real backward 13-week receipts
//     view (no projection), kept below as detail.
// Cash out / runway / tax are only real when a P&L cost source exists; every
// projection/estimate is flagged. Per-practice tab.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useState } from 'react';
import { Skeleton } from '@/components/ui';
import { poundsCompact, monthShort } from '../mock';
import { useCashflow, useCashflowOutlook } from '../hooks';
import { useBusinessHub, type HubWindow } from '@/features/overview/business-hub-api';
import { useMarketingRoi } from '@/features/growth/hooks';
import FinanceToolbar from './FinanceToolbar';
import CashflowKpiStrip from './CashflowKpiStrip';
import CashflowChart from './CashflowChart';
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange, thisMonthRange } from './DateRangeFilter';
import { PillRow, Pill } from '@/features/_shared/SectionFilterPills';
import type { CostBasis } from '../api';

const BRAND = 'var(--brand)';
const RUNWAY_COLOUR: Record<string, string> = {
  healthy: 'var(--success)',
  warning: 'var(--warning)',
  critical: 'var(--danger)',
};

// Full pound figure for cards/tables (the headline numbers want precision, not
// the £x.xM compaction used on charts).
const gbp = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const signed = (n: number) => (n >= 0 ? '+' : '−') + gbp(Math.abs(n));
// A figure we cannot know at this scope is an em dash, never £0. Guarded here
// rather than inside gbp so the call site has to think about it.
const gbpOrDash = (n: number | null) => (n == null ? '—' : gbp(n));
// How a cost figure should be described on screen. A toggle whose effect is
// invisible is a toggle nobody trusts.
const basisWord = (b: 'cash' | 'accrual' | null) =>
  b === 'cash' ? 'cash basis' : b === 'accrual' ? 'accrual basis' : null;
// Today's month as YYYY-MM. Needed because the outlook's last month is only
// "this month" while the selected window runs up to today.
const thisMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function shortWeek(d: string) {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

export default function CashflowScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(thisMonthRange());
  // Cash vs accrual COST base. QuickBooks is pulled on both and both are in the
  // table; this page used to take the accrual default and call its own cash-out
  // figure "a proxy". Cash is the default here because this is a cashflow page.
  const [basis, setBasis] = useState<CostBasis>('cash');
  const { data, isLoading, isError } = useCashflow(13, practiceId, range, basis);
  // forward = 0: NO projected months. This screen shows what actually happened
  // and nothing else. The projection averaged the current, part-finished month
  // in with complete ones, so on the 3rd of a month it forecast from three days
  // of takings and read a third low — an assumption presented beside real money.
  const { data: outlook } = useCashflowOutlook(12, 0, practiceId, range, basis);
  // Context strip — group KPIs + live paid-marketing efficiency, both following
  // the page's practice + period filters. Selected [from,to] → explicit window;
  // the filter defaults to the current month. The trailing-90-day fallback is
  // kept defensively for any null range. Practice scope is applied client-side
  // off hub.practices (business-hub has no practice_id param), mirroring Business Hub.
  const hubWin: HubWindow = range.from && range.to
    ? { since: range.from, until: range.to }
    : { days: 90 };
  const { data: hub } = useBusinessHub(hubWin);
  const { data: roi } = useMarketingRoi(practiceId, range);
  // The comparison window, from the Business Hub's own `compare` block so this
  // page and the Hub can never disagree about what "the previous period" was.
  // It is a SECOND CALL TO THE SAME ENDPOINTS rather than a compare_* parameter,
  // so the prior figure cannot drift from the one it is measured against — it
  // IS that figure, asked for a different window.
  const prevWin = hub?.group.compare
    ? { from: hub.group.compare.previous.since.slice(0, 10), to: hub.group.compare.previous.until.slice(0, 10) }
    : null;
  const { data: prevOutlook } = useCashflowOutlook(12, 0, practiceId, prevWin, basis);
  const { data: prevRoi } = useMarketingRoi(practiceId, prevWin);
  const weeks = data?.weeks ?? [];
  const hasData = weeks.length > 0;
  // RECEIPTS, which is what this panel says it shows. It used to plot a
  // "Closing" balance built by adding every receipt on top of today's bank
  // figure — a number that was neither a past balance nor a forecast. There is
  // no per-week outflow feed for any tenant, so there is no weekly balance to
  // draw; money in is the real series and now it is the one on the chart.
  const chartData = weeks.map((w) => ({
    week: shortWeek(w.weekStartDate),
    'Money in': w.receipts,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Cashflow &amp; Runway</h1>
        <p className="text-sm text-ink-muted">
          What came in, what went out, where your balance is heading, and how much cash is
          genuinely free to put to work.
        </p>
        <FinanceToolbar />
      </div>

      <PracticeTabs dentallyOnly value={practiceId} onChange={setPracticeId} />
      <DateRangeFilter value={range} onChange={setRange} />

      {/* Cash vs accrual, offered rather than assumed. Cash = money that moved;
          accrual = costs as they were incurred, whenever they get paid. */}
      <PillRow label="Cost base">
        <Pill active={basis === 'cash'} onClick={() => setBasis('cash')}>Cash</Pill>
        <Pill active={basis === 'accrual'} onClick={() => setBasis('accrual')}>Accrual</Pill>
      </PillRow>

      {outlook?.costsBasisFellBack && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">
            Showing {outlook.costsAccountingBasis === 'cash' ? 'cash' : 'accrual'} costs instead
          </div>
          <div className="text-sm text-ink-muted">
            Your accounting feed has no {outlook.costsBasisRequested === 'cash' ? 'cash' : 'accrual'}-basis
            figures, so the {outlook.costsAccountingBasis === 'cash' ? 'cash' : 'accrual'} ones are on screen.
            Everything below is on that basis.
          </div>
        </div>
      )}

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load cash flow</div>
          <div className="text-sm text-ink-muted">Refresh to retry.</div>
        </div>
      )}
      {!isError && !data?.bankConnected && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">No bank feed connected</div>
          <div className="text-sm text-ink-muted">
            Your cash position shows as £0 because no accounting or banking feed is linked
            yet. The money-in figures below are real settled payments and are unaffected.
          </div>
        </div>
      )}
      {!isError && data?.bankConnected && data?.bankStale && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">Bank balance may be stale</div>
          <div className="text-sm text-ink-muted">
            Last synced{' '}
            {data.lastSyncedAt
              ? new Date(data.lastSyncedAt).toLocaleDateString('en-GB')
              : 'unknown'}
            . Opening balance might not be current.
          </div>
        </div>
      )}

      {/* The scorecard strip. Its own component, built on the SHARED
          HeadlineCard, with each card's working behind a click. */}
      {hub && (
        <CashflowKpiStrip
          hub={hub}
          outlook={outlook}
          prevOutlook={prevOutlook}
          practiceId={practiceId}
          roi={roi}
          prevRoi={prevRoi}
        />
      )}

      {/* Headline — cash position, net this month, runway (from the outlook) */}
      {outlook && (() => {
        const cur = outlook.currentIndex >= 0 ? outlook.months[outlook.currentIndex] : null;
        const rw = outlook.runway;
        // The last month of the window is only "this month" when the window
        // runs up to today. Pick March and it is March — so the card must not
        // keep calling it "this month".
        const onCurrentMonth = cur?.month === thisMonthKey();
        return (
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="card-padded">
              {/* The bank balance is the ORGANISATION's — bank_accounts has no
                  practice_id and cannot have one. On a practice tab the figure
                  is still shown, because the money is real, but it is named as
                  the group's rather than passed off as this practice's. */}
              <div className="text-xs text-ink-muted uppercase">
                {outlook.bankAttributable ? 'Cash position today' : 'Group cash position'}
              </div>
              <div className="display text-3xl font-bold mt-1">{gbp(outlook.anchorBank)}</div>
              <div className="text-xs text-ink-muted mt-1">
                {!outlook.bankAttributable
                  ? 'Across all practices — bank accounts are not split by practice'
                  : cur && cur.closing != null
                    ? `Balance to date · ${monthShort(cur.month)} · ${gbp(cur.closing)}`
                    : "Where your bank sits right now — the dates above don't change it"}
              </div>
              {/* The Dashboard has always called this figure indicative, because
                  it adds up every account on the feed — card and clearing
                  accounts included. This page used to call the same number a
                  "real bank balance". One number, one story. */}
              {outlook.bankConnected && (
                <div className="text-xs text-ink-muted mt-1">
                  Indicative{outlook.bankSource ? ` · from ${outlook.bankSource}` : ''} · includes card and
                  clearing accounts
                </div>
              )}
              {!outlook.bankConnected && (
                <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                  Connect an accounting or banking feed for a live balance
                </div>
              )}
            </div>
            <div className="card-padded">
              {/* "so far", not "this month". Receipts are close to complete for
                  the days elapsed; COSTS are not — payroll, rent and lab bills
                  post late. Subtracting one from the other and heading it
                  "this month" reads as the month's trading. */}
              <div className="text-xs text-ink-muted uppercase">
                {!cur
                  ? 'Net cash'
                  : cur.costsPartial
                    ? `Net cash · ${monthShort(cur.month)} so far`
                    : onCurrentMonth ? 'Net cash this month' : `Net cash · ${monthShort(cur.month)}`}
              </div>
              <div
                className="display text-3xl font-bold mt-1"
                style={{ color: cur && cur.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
              >
                {cur && outlook.costsAvailable ? signed(cur.net) : '—'}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {cur ? `${gbp(cur.in)} in${outlook.costsAvailable ? ` · ${gbp(cur.out)} out` : ' · out not sourced'}` : ''}
              </div>
              {cur?.costsPartial && (
                <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                  Costs still posting — expect this to fall as the month closes
                </div>
              )}
            </div>
            <div
              className="card-padded"
              style={{ borderLeft: `4px solid ${RUNWAY_COLOUR[rw.status]}` }}
            >
              <div className="text-xs text-ink-muted uppercase">Runway</div>
              <div
                className="display text-3xl font-bold mt-1"
                style={{ color: rw.costsAvailable && outlook.bankAttributable ? RUNWAY_COLOUR[rw.status] : undefined }}
              >
                {/* Runway is cash ÷ burn. It needs BOTH a cost base and a cash
                    position, and a practice has no cash position of its own. */}
                {!outlook.bankAttributable || !rw.costsAvailable
                  ? '—'
                  : rw.cashPositive ? 'Self-funding' : `${rw.runwayMonths} mo`}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {!outlook.bankAttributable
                  ? 'measured for the group, not per practice'
                  : !rw.costsAvailable
                    ? 'needs a cost source'
                    : rw.cashPositive
                      ? `Balance grows ~${gbp(rw.monthlyNet)}/mo`
                      : 'months of cash at current burn'}
              </div>
            </div>
          </div>
        );
      })()}

      {outlook && !outlook.costsAvailable && (
        <div className="card-padded mb-6" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">
            {outlook.costsUnavailableReason === 'org-level-costs'
              ? 'Cash out is tracked for the group, not per practice'
              : 'Cash out is not yet measured'}
          </div>
          <div className="text-sm text-ink-muted">
            {outlook.costsUnavailableReason === 'org-level-costs'
              ? `Your accounting feed${outlook.outSource ? ` (${outlook.outSource})` : ''} is kept as independent companies rather than per practice, so cash out is a group figure by design. Select All practices to see it. Cash in below is real settled receipts for this practice.`
              : 'Connect Xero/QuickBooks or enter monthly financials so cash out, net cash and tax estimates become real. Cash in below is real settled receipts.'}
          </div>
        </div>
      )}

      {/* Cash in vs cash out + Will I run out of money? */}
      {outlook && outlook.months.length > 0 && (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card-padded">
            <h2 className="display text-lg font-semibold mb-1">Cash in vs cash out</h2>
            <p className="text-sm text-ink-muted mb-2">
              What lands in the bank against what leaves it, month by month. The month in
              progress shows the costs posted so far, not a full month of them.
            </p>
            {outlook.costsBasis !== 'none' && (
              <p className="text-xs text-ink-muted mb-4">
                <strong>Net = In − Out.</strong> In = settled patient payments received
                that month{outlook.inSource ? ` (from ${outlook.inSource})` : ''}. Out =
                running costs for that month{outlook.outSource ? ` (from ${outlook.outSource})` : ' (P&L cost base)'}
                {basisWord(outlook.costsAccountingBasis) ? `, ${basisWord(outlook.costsAccountingBasis)}` : ''}.
                {outlook.inFallbackSource && ' Months with no settled payments fall back to billed work — marked on the line.'}
              </p>
            )}
            {outlook.costsBasis === 'none' && (
              <div
                className="text-xs"
                style={{
                  background: 'var(--surface-muted, #f6f7f9)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 12,
                  color: 'var(--ink-muted)',
                }}
              >
                {outlook.costsUnavailableReason === 'org-level-costs' ? (
                  <>
                    Cash <strong>out</strong> is tracked for the group, not per practice, by
                    design. Select All practices to see it.
                    Only money <strong>in</strong> (settled receipts) is shown below.
                  </>
                ) : (
                  <>
                    Cash <strong>out</strong> needs an accounting feed. Connect QuickBooks or
                    Xero (or add monthly costs) to see outflows and net position.
                    Only money <strong>in</strong> (settled receipts) is shown below.
                  </>
                )}
              </div>
            )}
            {/* The chart replaces a four-line-per-month text list — twenty-four
                lines for a six-month window, all of it shape a reader had to
                assemble themselves. The exact figures are in the table beside
                it, so nothing is lost and the page is a screen shorter. */}
            <CashflowChart outlook={outlook} />
            <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>
              Chart shows recent months; figures beside it follow your selection. In = real settled receipts
              {outlook.inSource ? ` (${outlook.inSource})` : ''}; out = running costs
              {outlook.outSource ? ` (${outlook.outSource})` : outlook.costsBasis !== 'none' ? ` (${outlook.costsBasis})` : ' (not sourced)'}
              {basisWord(outlook.costsAccountingBasis) ? ` on the ${basisWord(outlook.costsAccountingBasis)}` : ''}.
              {' '}Costs are reported monthly, so a part-month selection still carries whole
              calendar months of cost. The current month is still in progress.
            </p>
          </div>

          <div className="card-padded">
            {/* The balance columns exist only when there is a balance to carry.
                A practice has no bank account of its own, so rather than print
                the group's balance against one practice's months, those two
                columns are dropped and the months keep the figures that ARE
                that practice's: money in, money out, net. */}
            {/* "Will I run out of money?" is a forward question. With no
                forecast months the table is a history, so it is not asked. */}
            <h2 className="display text-lg font-semibold mb-1">
              {!outlook.balancesAvailable
                ? 'Month by month'
                : outlook.months.some((m) => m.projected)
                  ? 'Will I run out of money?'
                  : 'Where your balance has been'}
            </h2>
            <p className="text-sm text-ink-muted mb-4">
              {outlook.balancesAvailable
                ? "Opening balance carried through each month's net to a closing balance."
                : outlook.balancesUnavailableReason === 'org-level-bank'
                  ? "This practice's money in and out. Balances are not shown because bank accounts belong to the group, not to a single practice."
                  : 'Money in and out for the months you have selected. Balances are only shown for a window that runs up to today, because they are worked back from your current bank position.'}
            </p>
            <table className="w-full" style={{ fontSize: 12 }}>
              <thead>
                <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Month</th>
                  {outlook.balancesAvailable && (
                    <th className="text-right" style={{ padding: '8px 6px' }}>Opening</th>
                  )}
                  <th className="text-right" style={{ padding: '8px 6px' }}>In</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Out</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Net</th>
                  {outlook.balancesAvailable && (
                    <th className="text-right" style={{ padding: '8px 6px' }}>Closing</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {outlook.months.map((m) => (
                  <tr key={m.month} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                      {monthShort(m.month)}
                      {m.projected ? '*' : ''}
                    </td>
                    {outlook.balancesAvailable && (
                      <td className="text-right" style={{ padding: '8px 6px' }}>{gbpOrDash(m.opening)}</td>
                    )}
                    <td className="text-right" style={{ padding: '8px 6px' }}>{gbp(m.in)}</td>
                    <td className="text-right" style={{ padding: '8px 6px' }}>
                      {m.costsAvailable ? `−${gbp(m.out)}` : '—'}
                      {m.costsPartial && (
                        <span className="text-ink-muted" style={{ fontSize: 10 }}> so far</span>
                      )}
                    </td>
                    <td
                      className="text-right"
                      style={{ padding: '8px 6px', color: m.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {outlook.costsAvailable ? signed(m.net) : '—'}
                    </td>
                    {outlook.balancesAvailable && (
                      <td className="text-right font-semibold" style={{ padding: '8px 6px' }}>
                        {gbpOrDash(m.closing)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>
              {/* A "lowest point" across a single month is that month's closing
                  balance restated under a different name — it tells the reader
                  nothing, so it is only shown once there is a trail. */}
              {outlook.lowestInWindow != null && outlook.months.length > 1 && (
                <>Lowest point in this window: <strong>{gbp(outlook.lowestInWindow)}</strong>. </>
              )}
              {outlook.balancesReconstructed
                ? "Balances are worked backwards from today's real bank position, so every opening figure here is derived rather than observed."
                : 'The current month is still in progress.'}
              {outlook.months.some((m) => m.costsPartial)
                ? ' Costs for the month in progress are still posting, so its Out and Net will move.'
                : ''}
            </p>
          </div>
        </div>
      )}

      {/* Bills to plan + Decision */}
      {outlook && (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card-padded">
            <div className="flex justify-between items-start mb-1">
              <h2 className="display text-lg font-semibold">Bills to plan for</h2>
              {outlook.bills.length > 0 && (
                <span
                  className="text-xs font-semibold"
                  style={{ background: '#FEF3C7', color: '#78350F', padding: '2px 8px', borderRadius: 6 }}
                >
                  {gbp(outlook.bills.reduce((s, b) => s + b.amount, 0))} est.
                </span>
              )}
            </div>
            <p className="text-sm text-ink-muted mb-4">
              Taxes and one-offs that wreck a cash position when they&apos;re not forecast.
            </p>
            {outlook.bills.length === 0 ? (
              <div className="text-sm text-ink-muted">
                No tax estimate yet — needs a profit figure (connect Xero or enter monthly
                financials).
              </div>
            ) : (
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                    <th style={{ padding: '8px 6px' }}>Item</th>
                    <th style={{ padding: '8px 6px' }}>Type</th>
                    <th style={{ padding: '8px 6px' }}>Window</th>
                    <th className="text-right" style={{ padding: '8px 6px' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {outlook.bills.map((b) => (
                    <tr key={b.item} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <strong>{b.item}</strong>
                        {b.estimated && (
                          <span className="text-ink-muted" style={{ fontSize: 10 }}> · estimate</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <span
                          className="text-xs"
                          style={{ background: '#FEF3C7', color: '#78350F', padding: '2px 8px', borderRadius: 6 }}
                        >
                          {b.type}
                        </span>
                      </td>
                      <td className="text-ink-muted" style={{ padding: '8px 6px' }}>{b.window}</td>
                      <td className="text-right font-semibold" style={{ padding: '8px 6px' }}>{gbp(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>{outlook.billsNote}</p>
          </div>

          <div className="card-padded">
            <h2 className="display text-lg font-semibold mb-1">Decision — mobilise free cash</h2>
            <p className="text-sm text-ink-muted mb-4">
              Cash above a sensible operating buffer is lazy money. Here&apos;s what&apos;s
              genuinely free to deploy.
            </p>
            {(() => {
              const d = outlook.decision;
              const rw = outlook.runway;
              const colour =
                d.action === 'sweep' ? 'var(--success)' : d.action === 'build_buffer' ? 'var(--warning)' : 'var(--ink-muted)';
              const title =
                d.action === 'unavailable'
                  ? 'Cash decisions are made for the group'
                  : d.action === 'sweep'
                    ? 'Sweep free cash to the holding company'
                    : d.action === 'build_buffer'
                      ? 'Build the buffer, then sweep'
                      : 'Hold — at the operating buffer';
              return (
                <div style={{ borderLeft: `4px solid ${colour}`, paddingLeft: 14 }}>
                  <div className="font-semibold" style={{ color: colour }}>{title}</div>
                  <p className="text-sm mt-2" style={{ lineHeight: 1.55 }}>
                    {/* Every figure in this card is cash-on-hand arithmetic, and
                        a practice has no cash on hand of its own. Saying so beats
                        offering the group's balance as this practice's to spend. */}
                    {d.action === 'unavailable' && (
                      <>
                        Your bank accounts belong to the group rather than to any one
                        practice, so there is no separate pot to sweep here. Switch to
                        <strong> All practices</strong> to see what is free to deploy.
                      </>
                    )}
                    {d.action !== 'unavailable' && !outlook.costsAvailable && (
                      <>Connect a cost source to measure your burn and buffer; free cash below is your real bank balance only.</>
                    )}
                    {outlook.costsAvailable && d.action === 'build_buffer' && d.buffer != null && (
                      <>
                        You&apos;re {rw.cashPositive ? `banking about ${gbp(rw.monthlyNet)} a month` : `burning about ${gbp(rw.monthlyBurn)} a month`}, but
                        {outlook.lowestProjected != null
                          ? ` the lowest point we forecast (${gbp(outlook.lowestProjected)}) is under a prudent two-week buffer of ${gbp(d.buffer)}.`
                          : ` your balance is under a prudent two-week buffer of ${gbp(d.buffer)}.`}
                        {' '}Build reserves until it clears that line — everything above then becomes free cash to sweep.
                      </>
                    )}
                    {outlook.costsAvailable && d.action === 'sweep' && d.buffer != null && d.sweepable != null && (
                      <>
                        {outlook.lowestProjected != null
                          ? `The lowest point we forecast (${gbp(outlook.lowestProjected)}) clears your two-week buffer of ${gbp(d.buffer)}.`
                          : `Your cash clears a prudent two-week buffer of ${gbp(d.buffer)}.`}
                        {' '}About <strong>{gbp(d.sweepable)}</strong> is genuinely free to deploy.
                      </>
                    )}
                    {outlook.costsAvailable && d.action === 'hold' && d.buffer != null && (
                      <>You&apos;re sitting roughly at the two-week operating buffer ({gbp(d.buffer)}). Hold the line — nothing is free to sweep yet.</>
                    )}
                  </p>
                  <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Free cash</div>
                      <div className="font-bold mt-1">{gbpOrDash(d.freeCash)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Op. buffer</div>
                      <div className="font-bold mt-1">
                        {outlook.costsAvailable ? gbpOrDash(d.buffer) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Sweepable</div>
                      <div
                        className="font-bold mt-1"
                        style={{ color: d.sweepable != null && d.sweepable > 0 ? 'var(--success)' : undefined }}
                      >
                        {gbpOrDash(d.sweepable)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="card-padded mb-4">
        {/* The window is whatever the filter above selected — the heading used
            to say "last 13 weeks" while the default filter is THIS MONTH, so it
            was wrong on first paint, every time. */}
        <h2 className="display text-lg font-semibold mb-1">Money in, week by week</h2>
        <p className="text-sm text-ink-muted mb-5">
          Every payment that actually cleared, grouped by the week it landed
          {weeks.length > 0 ? ` · ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}` : ''}.
        </p>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : !hasData ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No settled payments in the last 13 weeks
            {practiceId ? ' for this practice.' : '.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--ink-muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => poundsCompact(v)}
                width={56}
              />
              <Tooltip
                cursor={{ fill: 'var(--bg)' }}
                formatter={(v: number, name: string) => [gbp(v), name]}
                labelFormatter={(l: string) => `Week of ${l}`}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="Money in" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-1">Week by week</h2>
          <p className="text-sm text-ink-muted mb-4">
            The same money as the chart above, with a running total so you can see how
            the period built up.
          </p>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Week of</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Money in</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Running total</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStartDate} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{new Date(w.weekStartDate).toLocaleDateString('en-GB')}</strong>
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px', color: w.receipts > 0 ? 'var(--success)' : 'var(--ink-muted)' }}>
                    {w.receipts > 0 ? `+${gbp(w.receipts)}` : '—'}
                  </td>
                  <td className="text-right text-ink-muted" style={{ padding: '10px 8px' }}>
                    {gbp(w.cumulativeReceipts)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td className="font-semibold" style={{ padding: '10px 8px' }}>Total received</td>
                <td className="text-right font-semibold" style={{ padding: '10px 8px' }}>
                  {gbp(data?.totalReceipts ?? 0)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 12 }}>
            Money in only. We can show what landed because every settled payment is
            recorded, but nothing here tracks what left the account — so this table
            deliberately shows no bank balance. Your cash position is the card at the
            top of the page.
          </p>
        </div>
      )}

    </div>
  );
}
