'use client';
// Group Overview — QuickBooks roll-up. Summed cards across every connected
// QuickBooks company plus a per-company breakdown. Self-contained: reads the
// finance QB overview. Re-scoped by the QuickBooks company filter (accountId =
// one company, omitted = all summed) and the global data filter (from/to window)
// above its section. Hides itself when no company is connected.

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui';
import { getQuickBooksOverview } from '@/features/finance/quickbooks-api';

const gbp = (pence: number) => '£' + Math.round((pence || 0) / 100).toLocaleString('en-GB');

export function QuickBooksGroupSection({
  accountId = null,
  from,
  to,
  windowLabel,
}: {
  accountId?: string | null;
  from?: string;
  to?: string;
  windowLabel?: string;
} = {}) {
  const { data, isLoading } = useQuery({
    queryKey: ['qbo-finance', 'group', accountId ?? 'all', from ?? '', to ?? ''],
    queryFn: () => getQuickBooksOverview({ accountId: accountId ?? undefined, from, to }),
  });

  if (isLoading || !data || data.accounts.length === 0) return null;
  const s = data.summary;
  const span = windowLabel ?? 'selected period';

  return (
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
        <Stat label="Cash at Bank" value={gbp(s.cashAtBankPence)} />
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
