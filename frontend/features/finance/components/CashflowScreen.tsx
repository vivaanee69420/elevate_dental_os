'use client';
// Cash Flow — REAL data only. Backward 13-week view from
// GET /api/analytics/cashflow: each week = settled payments actually received
// that week (Dentally/Stripe), opening = real bank balance, closing = running
// balance. NO projection. The Business Health run-rate is drawn only as a
// dotted comparison target, never mixed into the real line. Per-practice tab.

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
import { poundsCompact } from '../mock';
import { useCashflow } from '../hooks';
import FinanceToolbar from './FinanceToolbar';
import PracticeTabs from '@/features/practices/PracticeTabs';

const BRAND = '#0E7C7B';
const TARGET = '#94A3B8';

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && (
        <div className="text-xs font-semibold mt-1" style={{ color: '#10B981' }}>
          {delta}
        </div>
      )}
    </div>
  );
}

function shortWeek(d: string) {
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

export default function CashflowScreen() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const { data, isLoading, isError } = useCashflow(13, practiceId);
  const weeks = data?.weeks ?? [];
  const hasData = weeks.length > 0;
  const opening = data?.openingBalance ?? 0;
  const closing = hasData ? weeks[weeks.length - 1].closing : opening;
  const totalReceipts = data?.totalReceipts ?? 0;
  const runRate = data?.baselineWeeklyRunRate ?? null;
  // Real closing line + a dotted "target" line = opening + run-rate accrued each
  // week (comparison only; null when no baseline). Never blended into Closing.
  const chartData = weeks.map((w, i) => ({
    week: shortWeek(w.weekStartDate),
    Closing: w.closing,
    Target: runRate != null ? opening + runRate * (i + 1) : undefined,
  }));

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Cash Flow</h1>
        <p className="text-sm text-ink-muted">
          Real cash received · last 13 weeks of settled payments (not a forecast)
        </p>
        <FinanceToolbar />
      </div>

      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load cash flow</div>
          <div className="text-sm text-ink-muted">Refresh to retry.</div>
        </div>
      )}
      {!isError && !data?.bankConnected && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
          <div className="font-semibold">No bank account connected</div>
          <div className="text-sm text-ink-muted">
            Opening balance is £0 — connect open banking for a real starting
            position. Weekly receipts below are real settled payments.
          </div>
        </div>
      )}
      {!isError && data?.bankConnected && data?.bankStale && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
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

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Kpi
          label="Opening balance"
          value={isLoading ? '…' : poundsCompact(opening)}
          delta="Real bank balance"
        />
        <Kpi
          label="Cash in (13 wks)"
          value={isLoading ? '…' : poundsCompact(totalReceipts)}
          delta="Settled payments received"
        />
        <Kpi
          label="Closing balance"
          value={isLoading ? '…' : poundsCompact(closing)}
        />
      </div>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">
          Closing balance — last 13 weeks
          {runRate != null && (
            <span className="text-xs text-ink-muted font-normal" style={{ marginLeft: 8 }}>
              · dotted line = Business Health run-rate (target, not real)
            </span>
          )}
        </h2>
        {isLoading ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            Loading…
          </div>
        ) : !hasData ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No settled payments in the last 13 weeks
            {practiceId ? ' for this practice.' : '.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
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
              {runRate != null && (
                <Line
                  type="monotone"
                  dataKey="Target"
                  stroke={TARGET}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              )}
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
