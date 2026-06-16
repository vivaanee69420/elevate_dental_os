'use client';
// Group Overview — QuickBooks roll-up. Summed cards across every connected
// QuickBooks company plus a per-company breakdown. Self-contained: reads the
// finance QB overview via the SAME query the dedicated Finance > QuickBooks
// screen uses — a clean `period` (YYYY-MM) or trailing-12 default. It owns its
// OWN period filter (rendered above the card) rather than the global ScopePeriod
// window: the global window resolves to UTC ISO instants, and slicing those to
// YYYY-MM is off-by-one under BST (London midnight 1 Jun = 2026-05-31T23:00Z →
// "2026-05"), which silently pulled in the prior month. Mirroring the QB screen's
// `period` param keeps this card byte-identical to that page.
// Re-scoped by the QuickBooks company filter (accountId = one company, omitted =
// all summed). Hides itself when no company is connected.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui';
import { getQuickBooksOverview } from '@/features/finance/quickbooks-api';

const gbp = (pence: number) => '£' + Math.round((pence || 0) / 100).toLocaleString('en-GB');

// 'YYYY-MM' -> 'Jan 2026' (cash as-of / period label).
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Last n month options for the period dropdown (YYYY-MM). Mirrors QuickBooksScreen.
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

export function QuickBooksGroupSection({
  accountId = null,
}: {
  accountId?: string | null;
} = {}) {
  const [period, setPeriod] = useState<string>(''); // '' = trailing 12 months (QB screen default)
  const periods = useMemo(() => recentPeriods(12), []);

  const { data, isLoading } = useQuery({
    queryKey: ['qbo-finance', 'group', accountId ?? 'all', period || 'last12'],
    queryFn: () => getQuickBooksOverview({ accountId: accountId ?? undefined, period: period || undefined }),
  });

  if (isLoading || !data || data.accounts.length === 0) return null;
  const s = data.summary;
  const span = period ? fmtMonth(period) : 'Last 12 months';

  return (
    <div>
      <div className="flex items-end justify-end mb-2">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="QuickBooks period"
          className="text-sm border border-border rounded-md bg-white px-2.5 py-1.5"
        >
          <option value="">Last 12 months</option>
          {periods.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="display text-lg font-semibold">QuickBooks (group)</h3>
            <p className="text-sm text-ink-muted mt-0.5">
              {span} across {data.accounts.length} connected{' '}
              {data.accounts.length === 1 ? 'company' : 'companies'}.
            </p>
          </div>
        </div>

        <div className="grid gap-3 mt-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Revenue" value={gbp(s.revenuePence)} />
          <Stat label="Net Profit" value={gbp(s.netProfitPence)} tone={s.netProfitPence >= 0 ? 'good' : 'bad'} />
          <Stat
            label={`Cash at Bank${s.cashAsOf && s.cashAsOf !== 'latest' ? ` (as of ${fmtMonth(s.cashAsOf)})` : ' (latest)'}`}
            value={gbp(s.cashAtBankPence)}
          />
          <Stat label="Outstanding Debtors" value={gbp(s.receivablesPence)} />
        </div>

        {data.companies.length > 1 && (
          <div className="mt-4">
            <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">By company</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-muted text-left text-xs">
                    <th className="py-1 pr-3">Company</th>
                    <th className="py-1 px-3 text-right">Revenue</th>
                    <th className="py-1 px-3 text-right">Net Profit</th>
                    <th className="py-1 px-3 text-right">Cash</th>
                    <th className="py-1 pl-3 text-right">Debtors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.accountId} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-semibold">{c.companyName}</td>
                      <td className="py-1.5 px-3 text-right">{gbp(c.revenuePence)}</td>
                      <td className="py-1.5 px-3 text-right" style={{ color: c.netProfitPence >= 0 ? '#047857' : '#B91C1C' }}>{gbp(c.netProfitPence)}</td>
                      <td className="py-1.5 px-3 text-right">{gbp(c.cashAtBankPence)}</td>
                      <td className="py-1.5 pl-3 text-right">{gbp(c.receivablesPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? '#047857' : tone === 'bad' ? '#B91C1C' : undefined;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="display text-2xl font-bold mt-1" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
