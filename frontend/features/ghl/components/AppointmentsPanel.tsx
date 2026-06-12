import { formatNumber } from '@/lib/format';
import type { GhlTotals } from '../api';

export function AppointmentsPanel({ appointments }: { appointments: GhlTotals['appointments'] }) {
  const a = appointments;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Appointments</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(a.booked)}</div><div className="text-[12px] text-slate-500">Booked</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(a.showed)}</div><div className="text-[12px] text-slate-500">Showed</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(a.noshow)}</div><div className="text-[12px] text-slate-500">No-show</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(a.cancelled)}</div><div className="text-[12px] text-slate-500">Cancelled</div></div>
      </div>
      <div className="mt-4">
        <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">By calendar</div>
        {a.byCalendar.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">No appointments in this period.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {a.byCalendar.map((c) => (
              <li key={c.calendar} className="flex items-center justify-between text-[13px]">
                <span className="truncate text-slate-700">{c.calendar}</span>
                <span className="font-medium text-slate-900">{formatNumber(c.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
