'use client';

// ScopePeriodBar — the global Scope + Period control at the top of each analytics
// view. Two pill rows: Scope (All practices + each synced practice, data-driven)
// and Period (Recent / This month / This year / Pick month / Custom). Writes the
// URL-synced ScopePeriod state; every mode resolves to a [since, until) window.

import { useMemo } from 'react';
import { usePractices } from '@/features/practices/hooks';
import { useScopePeriod } from './scope-context';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Last `count` months as {key,label} for the Pick-month picker (UTC, stable). */
function recentMonths(count = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-[13px] px-3.5 py-2 rounded-xl border whitespace-nowrap transition-colors ' +
        (active
          ? 'bg-brand text-white border-brand shadow-panel-sm font-medium'
          : 'bg-card text-ink border-border hover:border-brand-200')
      }
    >
      {children}
    </button>
  );
}

export function ScopePeriodBar({ hideScope = false }: { hideScope?: boolean } = {}) {
  const {
    scope, mode, monthKey, customSince, customUntil,
    setScope, setMode, setMonthKey, setYearKey, setCustom,
  } = useScopePeriod();
  const { data } = usePractices();
  const practices = data?.practices;

  const months = useMemo(() => recentMonths(12), []);
  const curMonth = currentMonthKey();
  const fieldCls =
    'text-[13px] border border-border bg-card text-ink px-3 py-2 rounded-xl shadow-panel-sm cursor-pointer';

  return (
    <div className="flex flex-col gap-2.5 mb-4">
      {/* Scope pills — All practices + every synced practice (data-driven). */}
      {!hideScope && (
        <div className="flex gap-2 flex-wrap items-center">
          <Pill active={scope === 'all'} onClick={() => setScope('all')}>
            All practices
          </Pill>
          {practices?.map((p) => (
            <Pill key={p.id} active={scope === p.id} onClick={() => setScope(p.id)}>
              {p.name}
            </Pill>
          ))}
        </div>
      )}

      {/* Period pills. */}
      <div className="flex gap-2 flex-wrap items-center">
        <Pill active={mode === 'recent'} onClick={() => setMode('recent')}>
          Recent
        </Pill>
        <Pill active={mode === 'month' && monthKey === curMonth} onClick={() => setMonthKey(curMonth)}>
          This month
        </Pill>
        <Pill active={mode === 'year'} onClick={() => setYearKey(String(new Date().getUTCFullYear()))}>
          This year
        </Pill>
        <Pill
          active={mode === 'month' && monthKey !== curMonth}
          onClick={() => setMonthKey(months[1]?.key || monthKey)}
        >
          Pick month
        </Pill>
        <Pill active={mode === 'custom'} onClick={() => setCustom(customSince, customUntil)}>
          Custom
        </Pill>

        {/* Contextual controls for Pick month / Custom. */}
        {mode === 'month' && (
          <select className={fieldCls} value={monthKey} onChange={(e) => setMonthKey(e.target.value)}>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        {mode === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              className={fieldCls}
              value={customSince}
              onChange={(e) => setCustom(e.target.value, customUntil)}
            />
            <span className="text-ink-soft text-[13px]">to</span>
            <input
              type="date"
              className={fieldCls}
              value={customUntil}
              onChange={(e) => setCustom(customSince, e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
