'use client';

// ScopePeriodBar — the global Scope + Period control rendered at the top of
// each analytics view (Overview, Profit, Valuation, Chair, etc.). Mirrors the
// prototype's .filters topbar. Reads/writes the URL-synced ScopePeriod state.
// Not in the global app shell: only analytics screens render it, so CRM/Inbox
// pages stay uncluttered ("map into existing screens" decision).

import { useMemo } from 'react';
import { usePractices } from '@/features/practices/hooks';
import { useScopePeriod } from './scope-context';

/** Last 6 months as {key,label} for the month picker (UTC, stable). */
function recentMonths(count = 6): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    out.push({ key, label });
  }
  return out;
}

export function ScopePeriodBar() {
  const { scope, period, periodKey, setScope, setPeriod, setPeriodKey } = useScopePeriod();
  const { data } = usePractices();
  const practices = data?.practices;

  const months = useMemo(() => recentMonths(6), []);
  // Keep the day key sensible when toggling to 'day': default to the 1st of the month.
  const dayKey = period === 'day' ? periodKey : `${(periodKey || months[0].key)}-01`;

  const sel =
    'text-[13px] border border-border bg-card text-ink px-3 py-2 rounded-xl shadow-panel-sm cursor-pointer';

  return (
    <div className="flex gap-2.5 flex-wrap items-end mb-4">
      <Field label="View by">
        <select
          className={sel}
          value={period}
          onChange={(e) => setPeriod(e.target.value === 'day' ? 'day' : 'month')}
        >
          <option value="month">Month</option>
          <option value="day">Day (cash collected)</option>
        </select>
      </Field>

      <Field label={period === 'day' ? 'Day' : 'Month'}>
        {period === 'month' ? (
          <select className={sel} value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            className={sel}
            value={dayKey}
            onChange={(e) => setPeriodKey(e.target.value)}
          />
        )}
      </Field>

      <Field label="Scope">
        <select className={sel} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Whole Group</option>
          <option value="practices">All Practices</option>
          {practices?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="academy">Academy</option>
          <option value="lab">Lab</option>
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] tracking-wider uppercase text-ink-soft font-semibold">{label}</label>
      {children}
    </div>
  );
}
