import { formatNumber, formatDate } from '@/lib/format';
import type { GhlPerAccount } from '../api';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  revoked: 'bg-slate-100 text-slate-500',
};

export function SyncHealthTable({
  accounts,
  onRowClick,
}: {
  accounts: GhlPerAccount[];
  onRowClick?: (a: GhlPerAccount) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-slate-200 bg-slate-50 text-[12px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Subaccount</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Contacts</th>
            <th className="px-4 py-2 text-right font-medium">Leads</th>
            <th className="px-4 py-2 text-right font-medium">Conversations</th>
            <th className="px-4 py-2 font-medium">Last sync</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr
              key={a.accountId ?? 'unmapped'}
              className={`border-b border-slate-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              onClick={onRowClick ? () => onRowClick(a) : undefined}
            >
              <td className="px-4 py-2 text-slate-900">{a.label}</td>
              <td className="px-4 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[12px] ${STATUS_STYLE[a.status ?? ''] ?? 'bg-slate-100 text-slate-500'}`}>
                  {a.status ?? '—'}
                </span>
                {a.lastError ? <span className="ml-2 text-[12px] text-rose-600" title={a.lastError}>error</span> : null}
              </td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.contacts)}</td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.leads)}</td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.conversations)}</td>
              <td className="px-4 py-2 text-slate-500">{a.lastSyncAt ? formatDate(a.lastSyncAt) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
