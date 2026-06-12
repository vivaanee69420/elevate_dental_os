import { formatNumber } from '@/lib/format';
import type { CountEntry } from '../api';

export function SourceBreakdown({ sources }: { sources: CountEntry[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Contacts by source</h3>
      {sources.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">No contacts in this period.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-[13px]">
              <span className="truncate text-slate-700">{s.source}</span>
              <span className="font-medium text-slate-900">{formatNumber(s.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
