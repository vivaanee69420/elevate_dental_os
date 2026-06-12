import { formatNumber } from '@/lib/format';
import type { CountEntry } from '../api';

export function PipelineByStage({ stages }: { stages: CountEntry[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Leads by stage</h3>
      {stages.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">No leads in this period.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stages.map((s) => (
            <li key={s.stage} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-[13px] text-slate-700">{s.stage}</span>
              <span className="h-2 flex-1 rounded-full bg-slate-100">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${(s.count / max) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-[13px] font-medium text-slate-900">{formatNumber(s.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
