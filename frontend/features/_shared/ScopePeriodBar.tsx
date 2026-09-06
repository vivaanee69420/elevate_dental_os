'use client';

// ScopePeriodBar — the global Scope + Period control at the top of each analytics
// view. Two pill rows: Scope (All practices + each synced practice, data-driven)
// and Period (Recent / This month / This year / Pick month / Custom). Writes the
// URL-synced ScopePeriod state; every mode resolves to a [since, until) window.

import { useEffect, useMemo } from 'react';
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

/** An ad platform a page can be scoped to. Matches ad_accounts.provider. */
export type AdProvider = 'google_ads' | 'meta_ads';

export function ScopePeriodBar({
  hideScope = false,
  hidePeriod = false,
  dentallyOnly = false,
  adProvider,
}: {
  hideScope?: boolean;
  hidePeriod?: boolean;
  dentallyOnly?: boolean;
  /**
   * Scope the row to practices that have an account with THIS ad platform.
   * A practice the platform knows nothing about renders a confident £0 that
   * reads as "we spent nothing here" rather than "this practice is not
   * connected", so it is not offered at all.
   */
  adProvider?: AdProvider;
} = {}) {
  const {
    scope, mode, monthKey, customSince, customUntil,
    setScope, setMonthKey, setYearKey, setCustom,
  } = useScopePeriod();
  const { data } = usePractices();
  const loaded = data?.practices != null;
  // By default the scope row lists every practice (Business Hub + Elevate CRM
  // want the GoHighLevel subaccounts visible). GoHighLevel auto-creates
  // pms_site_id-null pseudo-practices for CRM scoping; analytics views pass
  // `dentallyOnly` to drop those and show only real Dentally-mapped sites.
  const practices = useMemo(() => {
    let rows = data?.practices;
    if (dentallyOnly) rows = rows?.filter((p) => p.pms_site_id != null);
    if (adProvider) {
      // An ABSENT ad_providers list means an older cached response that cannot
      // answer the question — show the practice rather than silently drop it.
      // An EMPTY list is a definite "mapped to nothing" and is dropped.
      rows = rows?.filter((p) => !p.ad_providers || p.ad_providers.includes(adProvider));
    }
    return rows;
  }, [data?.practices, dentallyOnly, adProvider]);

  // Scope lives in the URL and ScopePeriodProvider spans the whole dashboard,
  // so a practice picked on one page survives the move to another. Selecting
  // Bexleyheath on /marketing-facebook and navigating to /marketing-google
  // would leave that filter APPLIED with its chip gone — the page would report
  // zeros for a practice with no Google account. Drop back to the group view
  // whenever the current scope is not one this page can offer.
  const offered = practices?.map((p) => p.id).join(',') ?? '';
  useEffect(() => {
    if (!adProvider || !loaded || scope === 'all') return;
    if (!offered.split(',').includes(scope)) setScope('all');
    // setScope is re-created per render by the provider; the guards above make
    // this idempotent (it converges the moment scope becomes 'all').
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adProvider, loaded, scope, offered]);

  // A provider-scoped page for an org with no connected practices shows no
  // scope row at all — a lone "All practices" pill is a control with nothing
  // to control. The page's own not_connected state does the explaining.
  const hideScopeRow = hideScope || (!!adProvider && loaded && (practices?.length ?? 0) === 0);

  const months = useMemo(() => recentMonths(12), []);
  const curMonth = currentMonthKey();
  const fieldCls =
    'text-[13px] border border-border bg-card text-ink px-3 py-2 rounded-xl shadow-panel-sm cursor-pointer';

  return (
    <div className="flex flex-col gap-2.5 mb-4">
      {/* Scope pills — All practices + every synced practice (data-driven). */}
      {!hideScopeRow && (
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
      {!hidePeriod && (
      <div className="flex gap-2 flex-wrap items-center">
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
      )}
    </div>
  );
}
