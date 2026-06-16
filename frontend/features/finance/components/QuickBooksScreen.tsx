'use client';
// Finance > QuickBooks dashboard. Mirrors the Dentally-style filter bar: a
// company selector (All companies / a specific QBO company) + period / date
// range, driving summed-or-per-company P&L, cash, receivables and receipts.
// All figures are integer pence from the backend; display in £ (en-GB).

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { getQuickBooksOverview, type QbQuery } from '../quickbooks-api';

const gbp = (pence: number) => '£' + Math.round((pence || 0) / 100).toLocaleString('en-GB');
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

const BUCKET_LABELS: Record<string, string> = {
  revenue: 'Revenue', associates: 'Associates', staff: 'Staff', lab: 'Lab', materials: 'Materials',
  overhead: 'Overhead', tax: 'Tax', other: 'Other',
};

// 'YYYY-MM' -> 'Jan 2026' (for the cash as-of label).
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Last 12 month options for the period dropdown (YYYY-MM).
function recentPeriods(n = 12): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  for (let i = 0; i < n; i++) {
    const value = `${y}-${String(m + 1).padStart(2, '0')}`;
    const label = new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    out.push({ value, label });
    m -= 1; if (m < 0) { m = 11; y -= 1; }
  }
  return out;
}

export default function QuickBooksScreen() {
  const [accountId, setAccountId] = useState<string>(''); // '' = all companies
  const [period, setPeriod] = useState<string>('');       // '' = trailing 12 months

  const query: QbQuery = useMemo(
    () => ({ accountId: accountId || null, period: period || null }),
    [accountId, period],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['qbo-finance', accountId, period],
    queryFn: () => getQuickBooksOverview(query),
  });

  const periods = useMemo(() => recentPeriods(12), []);
  const accounts = data?.accounts ?? [];
  const s = data?.summary;

  const trendData = (data?.trend ?? []).map((t) => ({
    period: t.period.slice(2), // YY-MM compact
    Revenue: Math.round(t.revenuePence / 100),
    Expenses: Math.round(t.expensesPence / 100),
    Profit: Math.round(t.netProfitPence / 100),
  }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 className="display" style={{ fontSize: 22, fontWeight: 700 }}>QuickBooks</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Profit &amp; loss, cash, debtors and receipts across every connected QuickBooks company.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={sel} aria-label="Company">
            <option value="">All companies</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.companyName}</option>
            ))}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={sel} aria-label="Period">
            <option value="">Last 12 months</option>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="card-padded" style={{ marginBottom: 16, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
          Failed to load QuickBooks data: {(error as Error).message}
        </div>
      )}

      {isLoading || !s ? (
        <div className="card-padded text-ink-muted" style={{ fontSize: 13 }}>Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="card-padded text-ink-muted" style={{ fontSize: 13 }}>
          No QuickBooks companies connected yet. Connect one under System → Integrations.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <Stat label="Revenue" value={gbp(s.revenuePence)} />
            <Stat label="Expenses" value={gbp(s.expensesPence)} />
            <Stat label="Net Profit" value={gbp(s.netProfitPence)} tone={s.netProfitPence >= 0 ? 'good' : 'bad'} />
            <Stat label="Net Margin" value={pct(s.netMarginPct)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <Stat label={`Cash at Bank${s.cashAsOf && s.cashAsOf !== 'latest' ? ` (as of ${fmtMonth(s.cashAsOf)})` : ' (latest)'}`} value={gbp(s.cashAtBankPence)} />
            <Stat label="Outstanding Receivables" value={gbp(s.receivablesPence)} />
            <Stat label="Receipts Collected" value={gbp(s.receiptsPence)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 20 }}>
            <div className="card-padded">
              <h2 className="display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Revenue, expenses &amp; profit by month</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => '£' + (v / 1000).toFixed(0) + 'k'} />
                  <Tooltip formatter={(v: number) => '£' + v.toLocaleString('en-GB')} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Revenue" fill="#2563EB" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Profit" fill="#10B981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card-padded">
              <h2 className="display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>P&amp;L by category</h2>
              <table className="w-full">
                <tbody>
                  {Object.entries(BUCKET_LABELS).map(([key, label]) => (
                    <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 4px', fontSize: 13 }}>{label}</td>
                      <td style={{ padding: '6px 4px', fontSize: 13, textAlign: 'right', fontWeight: 600 }}>
                        {gbp((data!.byBucket as unknown as Record<string, number>)[key] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!accountId && data!.companies.length > 0 && (
            <div className="card-padded">
              <h2 className="display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>By company</h2>
              <table className="w-full">
                <thead>
                  <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: 6 }}>Company</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Revenue</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Expenses</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Net Profit</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Margin</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Cash</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Debtors</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.companies.map((c) => (
                    <tr key={c.accountId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontSize: 13, fontWeight: 600 }}>{c.companyName}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right' }}>{gbp(c.revenuePence)}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right' }}>{gbp(c.expensesPence)}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right', color: c.netProfitPence >= 0 ? '#047857' : '#B91C1C' }}>{gbp(c.netProfitPence)}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right' }}>{pct(c.netMarginPct)}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right' }}>{gbp(c.cashAtBankPence)}</td>
                      <td style={{ padding: 6, fontSize: 13, textAlign: 'right' }}>{gbp(c.receivablesPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? '#047857' : tone === 'bad' ? '#B91C1C' : 'var(--ink)';
  return (
    <div className="card-padded">
      <div className="text-ink-muted" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const sel: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'white' };
