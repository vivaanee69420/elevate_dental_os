'use client';
// Cash Flow — real-data wired. 13-week rolling forecast from
// GET /api/analytics/cashflow: opening = real bank balance (flags if no
// bank / stale sync), weekly receipts/payments = baseline run-rate
// seasonalised + real settled payments overlaid. basis: baseline-projection
// (NOT a guaranteed forecast). Closing/status from formulas.calculateCashFlow.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { poundsCompact } from '../mock';
import { useCashflow } from '../hooks';

const BRAND = '#0E7C7B';
const STATUS_COLOUR: Record<string, string> = {
  healthy: '#10B981',
  warning: '#F59E0B',
  critical: '#EF4444',
};

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
  const { data, isLoading, isError } = useCashflow(13);
  const weeks = data?.weeks ?? [];
  const noBaseline = !!data?.error;
  const hasData = weeks.length > 0;
  const opening = hasData ? weeks[0].opening : 0;
  const closing = hasData ? weeks[weeks.length - 1].closing : 0;
  const net = closing - opening;
  const chartData = weeks.map((w) => ({
    week: shortWeek(w.weekStartDate),
    Closing: w.closing,
  }));

  return (
    <div className="container max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Cash Flow</h1>
        <p className="text-sm text-ink-muted">
          13-week rolling forecast · baseline projection + real payments
          overlaid (not a guaranteed forecast)
        </p>
      </div>

      {isError && (
        <div className="card-padded mb-4">
          <div className="font-semibold">Could not load cash flow</div>
          <div className="text-sm text-ink-muted">Refresh to retry.</div>
        </div>
      )}
      {noBaseline && !isError && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
          <div className="font-semibold">No baseline set</div>
          <div className="text-sm text-ink-muted">
            The forecast run-rate reads from your Business Health baseline.
            Complete setup to populate it.
          </div>
        </div>
      )}
      {hasData && !data?.bankConnected && (
        <div className="card-padded mb-4" style={{ borderLeft: '4px solid #F59E0B' }}>
          <div className="font-semibold">No bank account connected</div>
          <div className="text-sm text-ink-muted">
            Opening balance is £0 — connect open banking for a real starting
            position. Projection still shows the run-rate.
          </div>
        </div>
      )}
      {hasData && data?.bankConnected && data?.bankStale && (
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
          delta="All bank accounts"
        />
        <Kpi
          label="Projected closing (13wk)"
          value={isLoading ? '…' : poundsCompact(closing)}
          delta={net >= 0 ? `+${poundsCompact(net)}` : poundsCompact(net)}
        />
        <Kpi
          label="Avg weekly net"
          value={
            isLoading ? '…' : poundsCompact(Math.round(net / Math.max(1, weeks.length)))
          }
        />
      </div>

      <div className="card-padded mb-4">
        <h2 className="display text-lg font-semibold mb-5">
          Closing balance — next 13 weeks
        </h2>
        {isLoading ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            Loading…
          </div>
        ) : !hasData ? (
          <div className="text-ink-muted" style={{ fontSize: 13, padding: '60px 0' }}>
            No forecast — set your Business Health baseline.
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
                formatter={(v: number) => [poundsCompact(v), 'Closing']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="Closing" stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && (
        <div className="card-padded">
          <h2 className="display text-lg font-semibold mb-4">13-week detail</h2>
          <table className="w-full" style={{ fontSize: 13, margin: '-16px 0 0' }}>
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Week of</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Opening</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Receipts</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Payments</th>
                <th className="text-right" style={{ padding: '10px 8px' }}>Net</th>
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
                  <td className="text-right" style={{ padding: '10px 8px', color: 'var(--danger)' }}>
                    −{poundsCompact(w.payments)}
                  </td>
                  <td className="text-right font-semibold" style={{ padding: '10px 8px' }}>
                    {poundsCompact(w.receipts - w.payments)}
                  </td>
                  <td
                    className="text-right font-semibold"
                    style={{ padding: '10px 8px', color: STATUS_COLOUR[w.status] ?? 'inherit' }}
                  >
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
