import { formatNumber } from '@/lib/format';
import type { GhlTotals } from '../api';

export function ConversationActivity({ conversations }: { conversations: GhlTotals['conversations'] }) {
  const { total, inbound, outbound, last7d } = conversations;
  const inPct = total > 0 ? Math.round((inbound / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Conversations</h3>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(inbound)}</div><div className="text-[12px] text-slate-500">Inbound</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(outbound)}</div><div className="text-[12px] text-slate-500">Outbound</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(last7d)}</div><div className="text-[12px] text-slate-500">Last 7 days</div></div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <span className="block h-2 bg-brand" style={{ width: `${inPct}%` }} />
      </div>
      <div className="mt-1 text-[12px] text-slate-500">{inPct}% inbound</div>
    </div>
  );
}
