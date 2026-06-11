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
  LineChart,
  Line,
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
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange } from './DateRangeFilter';

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

function shortWeek(d: string) {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

// Compact KPI for the top context strip. `tag` is an optional pill (tone:
// good | warn | muted) under the sublabel.
function StripKpi({
  label,
  value,
  sub,
  tag,
  tone = 'muted',
}: {
  label: string;
  value: string;
  sub?: string;
  tag?: string;
  tone?: 'good' | 'warn' | 'muted';
}) {
  const tagBg = tone === 'good' ? 'var(--success-50, #DCFCE7)' : tone === 'warn' ? '#FEF3C7' : 'var(--bg)';
  const tagFg = tone === 'good' ? 'var(--success)' : tone === 'warn' ? '#78350F' : 'var(--ink-muted)';
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase" style={{ letterSpacing: '0.04em' }}>{label}</div>
      <div className="display text-2xl font-bold mt-1" style={{ lineHeight: 1.05 }}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
      {tag && (
        <span
          className="text-xs font-semibold"
          style={{ display: 'inline-block', marginTop: 8, background: tagBg, color: tagFg, padding: '2px 8px', borderRadius: 999 }}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

export default function CashflowScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const { data, isLoading, isError } = useCashflow(13, practiceId, range);
  const { data: outlook } = useCashflowOutlook(4, 2, practiceId);
  // Context strip — group KPIs + live paid-marketing efficiency, both following
  // the page's practice + period filters. Custom [from,to] → explicit window;
  // "Recent" (no range) → trailing 90 days. Practice scope is applied client-side
  // off hub.practices (business-hub has no practice_id param), mirroring Business Hub.
  const hubWin: HubWindow = range.from && range.to
    ? { since: range.from, until: range.to }
    : { days: 90 };
  const { data: hub } = useBusinessHub(hubWin);
  const { data: roi } = useMarketingRoi(practiceId, range);
  const weeks = data?.weeks ?? [];
  const hasData = weeks.length > 0;
  // Real closing balance only — no projection, no comparison line.
  const chartData = weeks.map((w) => ({
    week: shortWeek(w.weekStartDate),
    Closing: w.closing,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Cashflow &amp; Runway</h1>
        <p className="text-sm text-ink-muted">
          Cash in vs cash out, projected closing balance month by month, the tax bills to
          plan for, and the free cash to mobilise.
        </p>
        <FinanceToolbar />
      </div>

      <PracticeTabs value={practiceId} onChange={setPracticeId} />
      <DateRangeFilter value={range} onChange={setRange} />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load cash flow</div>
          <div className="text-sm text-ink-muted">Refresh to retry.</div>
        </div>
      )}
      {!isError && !data?.bankConnected && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="font-semibold">No bank account connected</div>
          <div className="text-sm text-ink-muted">
            Opening balance is £0 — connect open banking for a real starting
            position. Weekly receipts below are real settled payments.
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

      {/* Context strip — group KPIs + live paid-marketing efficiency, scoped to the
          page's practice + period filters.
          Group revenue is settled receipts (cash basis = cash collected);
          profit is contribution from the baseline margin. Ad metrics are real
          when an ad account is connected, else honest "not connected". */}
      {hub && (() => {
        const g = hub.group;
        // Practice scope: turnover, conversion + new patients ARE practice-attributed
        // (Dentally), so a selected practice narrows them to that row. Target + margin
        // only exist group-wide — drop the vs-target chip when a practice is picked.
        const pr = practiceId ? hub.practices.find((p) => p.practiceId === practiceId) ?? null : null;
        const turnover = (pr ? pr.revenuePence : g.revenuePence) / 100;
        const target = g.revenueTargetPence / 100;
        const vsTarget = !pr && target > 0 ? (turnover / target - 1) * 100 : null;
        const profit = turnover * (g.marginPct || 0) / 100;
        const conversion = pr ? pr.conversionRate : g.conversionRate;
        const newPatients = pr ? pr.newPatients : g.newPatients;
        const connected = !!roi?.connected;
        const spend = connected ? roi!.spend_pence / 100 : null;
        const spendPctTurn = spend != null && turnover > 0 ? (spend / turnover) * 100 : null;
        const roas = connected ? roi!.roas : 0;
        const costPerPatient = spend != null && newPatients > 0 ? spend / newPatients : null;
        const periodSub = range.from && range.to ? 'Selected period' : 'Last 90 days';
        return (
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            <StripKpi
              label="Group turnover"
              value={gbp(turnover)}
              sub={`Settled receipts · ${periodSub}`}
              tag={vsTarget != null ? `${vsTarget >= 0 ? '▲' : '▼'} ${Math.abs(vsTarget).toFixed(0)}% vs target` : undefined}
              tone={vsTarget != null && vsTarget >= 0 ? 'good' : 'warn'}
            />
            <StripKpi
              label="Group profit"
              value={g.marginPct ? gbp(profit) : '—'}
              sub={g.marginPct ? `Contribution · ${g.marginPct.toFixed(1)}% of turnover` : 'Set a baseline margin'}
            />
            <StripKpi
              label="New patients"
              value={String(newPatients)}
              sub={costPerPatient != null ? `${gbp(costPerPatient)} cost / patient` : 'New-patient exams (Dentally)'}
            />
            <StripKpi
              label="Marketing spend"
              value={spend != null ? gbp(spend) : '—'}
              sub={spend != null ? 'Tracked acquisition spend' : 'Not connected'}
              tag={spendPctTurn != null ? `${spendPctTurn.toFixed(1)}% of turnover` : undefined}
              tone="warn"
            />
            <StripKpi
              label="Blended paid ROAS"
              value={connected && roas ? `${roas.toFixed(2)}×` : '—'}
              sub={connected ? 'Paid revenue ÷ paid spend' : 'Not connected'}
              tag={connected && roas ? (roas >= 3 ? 'Healthy' : 'Watch') : undefined}
              tone={connected && roas >= 3 ? 'good' : 'warn'}
            />
            <StripKpi
              label="Lead conversion"
              value={`${(conversion || 0).toFixed(0)}%`}
              sub={`Lead → appointment · ${periodSub}`}
            />
          </div>
        );
      })()}

      {/* Headline — cash position, net this month, runway (from the outlook) */}
      {outlook && (() => {
        const cur = outlook.currentIndex >= 0 ? outlook.months[outlook.currentIndex] : null;
        const rw = outlook.runway;
        return (
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="card-padded">
              <div className="text-xs text-ink-muted uppercase">Cash position today</div>
              <div className="display text-3xl font-bold mt-1">{gbp(outlook.anchorBank)}</div>
              <div className="text-xs text-ink-muted mt-1">
                {cur ? `Projected close ${monthShort(cur.month)} · ${gbp(cur.closing)}` : 'Real bank balance'}
              </div>
              {!outlook.bankConnected && (
                <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                  Connect open banking for a real balance
                </div>
              )}
            </div>
            <div className="card-padded">
              <div className="text-xs text-ink-muted uppercase">Net cash this month</div>
              <div
                className="display text-3xl font-bold mt-1"
                style={{ color: cur && cur.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
              >
                {cur && outlook.costsAvailable ? signed(cur.net) : '—'}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {cur ? `${gbp(cur.in)} in${outlook.costsAvailable ? ` · ${gbp(cur.out)} out` : ' · out not sourced'}` : ''}
              </div>
            </div>
            <div
              className="card-padded"
              style={{ borderLeft: `4px solid ${RUNWAY_COLOUR[rw.status]}` }}
            >
              <div className="text-xs text-ink-muted uppercase">Runway</div>
              <div className="display text-3xl font-bold mt-1" style={{ color: RUNWAY_COLOUR[rw.status] }}>
                {!rw.costsAvailable ? '—' : rw.cashPositive ? 'Self-funding' : `${rw.runwayMonths} mo`}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {!rw.costsAvailable
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
          <div className="font-semibold">Cash out is not yet measured</div>
          <div className="text-sm text-ink-muted">
            Connect Xero/QuickBooks or enter monthly financials so cash out, net cash, runway
            and tax estimates become real. Cash in below is real settled receipts.
          </div>
        </div>
      )}

      {/* Cash in vs cash out + Will I run out of money? */}
      {outlook && outlook.months.length > 0 && (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card-padded">
            <h2 className="display text-lg font-semibold mb-1">Cash in vs cash out</h2>
            <p className="text-sm text-ink-muted mb-4">
              What lands in the bank against what leaves it, month by month.
            </p>
            {outlook.months.map((m) => (
              <div key={m.month} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div className="flex justify-between items-center">
                  <strong>
                    {monthShort(m.month)}
                    {m.projected ? '*' : ''}
                  </strong>
                  <span style={{ fontWeight: 600, color: m.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {outlook.costsAvailable ? `${signed(m.net)} net` : `${gbp(m.in)} in`}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-ink-muted mt-1">
                  <span>In</span>
                  <span>{gbp(m.in)}</span>
                </div>
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>Out</span>
                  <span>{m.costsAvailable ? gbp(m.out) : '—'}</span>
                </div>
              </div>
            ))}
            <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>
              * projected from recent run-rate. In = real settled receipts; out = P&amp;L cost base
              {outlook.costsBasis !== 'none' ? ` (${outlook.costsBasis})` : ' (not sourced)'}.
            </p>
          </div>

          <div className="card-padded">
            <h2 className="display text-lg font-semibold mb-1">Will I run out of money?</h2>
            <p className="text-sm text-ink-muted mb-4">
              Opening balance carried through each month&apos;s net to a projected closing balance.
            </p>
            <table className="w-full" style={{ fontSize: 12 }}>
              <thead>
                <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Month</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Opening</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>In</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Out</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Net</th>
                  <th className="text-right" style={{ padding: '8px 6px' }}>Closing</th>
                </tr>
              </thead>
              <tbody>
                {outlook.months.map((m) => (
                  <tr key={m.month} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                      {monthShort(m.month)}
                      {m.projected ? '*' : ''}
                    </td>
                    <td className="text-right" style={{ padding: '8px 6px' }}>{gbp(m.opening)}</td>
                    <td className="text-right" style={{ padding: '8px 6px' }}>{gbp(m.in)}</td>
                    <td className="text-right" style={{ padding: '8px 6px' }}>
                      {m.costsAvailable ? `−${gbp(m.out)}` : '—'}
                    </td>
                    <td
                      className="text-right"
                      style={{ padding: '8px 6px', color: m.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {outlook.costsAvailable ? signed(m.net) : '—'}
                    </td>
                    <td className="text-right font-semibold" style={{ padding: '8px 6px' }}>{gbp(m.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 10 }}>
              Lowest projected point: <strong>{gbp(outlook.lowestProjected)}</strong>.
              {outlook.balancesReconstructed
                ? " Historical balances reconstructed from today's bank balance; * months projected."
                : ' * months projected from run-rate.'}
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
                d.action === 'sweep'
                  ? 'Sweep free cash to the holding company'
                  : d.action === 'build_buffer'
                    ? 'Build the buffer, then sweep'
                    : 'Hold — at the operating buffer';
              return (
                <div style={{ borderLeft: `4px solid ${colour}`, paddingLeft: 14 }}>
                  <div className="font-semibold" style={{ color: colour }}>{title}</div>
                  <p className="text-sm mt-2" style={{ lineHeight: 1.55 }}>
                    {!outlook.costsAvailable && (
                      <>Connect a cost source to measure your burn and buffer; free cash below is your real bank balance only.</>
                    )}
                    {outlook.costsAvailable && d.action === 'build_buffer' && (
                      <>
                        You&apos;re {rw.cashPositive ? `banking about ${gbp(rw.monthlyNet)} a month` : `burning about ${gbp(rw.monthlyBurn)} a month`}, but
                        the lowest projected balance ({gbp(outlook.lowestProjected)}) is under a prudent two-week buffer of {gbp(d.buffer)}.
                        Build reserves until it clears that line — everything above then becomes free cash to sweep.
                      </>
                    )}
                    {outlook.costsAvailable && d.action === 'sweep' && (
                      <>
                        Your lowest projected balance ({gbp(outlook.lowestProjected)}) clears the two-week buffer of {gbp(d.buffer)}.
                        About <strong>{gbp(d.sweepable)}</strong> is genuinely free to deploy.
                      </>
                    )}
                    {outlook.costsAvailable && d.action === 'hold' && (
                      <>You&apos;re sitting roughly at the two-week operating buffer ({gbp(d.buffer)}). Hold the line — nothing is free to sweep yet.</>
                    )}
                  </p>
                  <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Free cash</div>
                      <div className="font-bold mt-1">{gbp(d.freeCash)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Op. buffer</div>
                      <div className="font-bold mt-1">{outlook.costsAvailable ? gbp(d.buffer) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted uppercase">Sweepable</div>
                      <div className="font-bold mt-1" style={{ color: d.sweepable > 0 ? 'var(--success)' : undefined }}>
                        {gbp(d.sweepable)}
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
        <h2 className="display text-lg font-semibold mb-5">
          Weekly receipts — last 13 weeks (real settled payments)
        </h2>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 240 }} />
        ) : !hasData ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No settled payments in the last 13 weeks
            {practiceId ? ' for this practice.' : '.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
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
                formatter={(v: number, name: string) => [poundsCompact(v), name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="Closing" stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">Weekly receipts (real)</h2>
          <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Week of</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Opening</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Received</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Closing</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStartDate} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{new Date(w.weekStartDate).toLocaleDateString('en-GB')}</strong>
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px' }}>
                    {poundsCompact(w.opening)}
                  </td>
                  <td className="text-right" style={{ padding: '10px 8px', color: 'var(--success)' }}>
                    +{poundsCompact(w.receipts)}
                  </td>
                  <td className="text-right font-semibold" style={{ padding: '10px 8px' }}>
                    {poundsCompact(w.closing)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
