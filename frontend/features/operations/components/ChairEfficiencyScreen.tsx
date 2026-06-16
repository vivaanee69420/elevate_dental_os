'use client';

// Chair Efficiency (GM Intelligence OS) — every chair as an asset: true
// occupancy vs paid-for capacity, the cost of empty chairs, and the recovery
// plan. Scope/period-driven. Money via formatPence (pence -> £). New green/gold
// system + shared primitives. OCPSPD / profit-per-chair-hour land later
// (backend returns null with a note).

import { useEffect, useState } from 'react';
import { PageHeader, KpiTile, DataTable, EmptyState, AlertRow, SkeletonKpiRow, SkeletonTable, type Column } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { formatPence } from '@/lib/format';
import { useChairAnalytics } from '../chair-analytics-hooks';
import type { ChairPracticeRow } from '../chair-analytics-api';
import { useChairConfig, useSaveChairConfig } from '../chair-config-hooks';
import type { ChairConfig } from '../chair-config-api';

const UPLIFTS = [0, 5, 10, 20, 40];

export function ChairEfficiencyScreen() {
  const [recover, setRecover] = useState(10);
  const { data, isLoading, isError, error } = useChairAnalytics(recover);

  const cols: Column<ChairPracticeRow>[] = [
    {
      header: 'Practice',
      render: (r) => (
        <span className="font-semibold">
          {r.name}
          {r.utilAssumed && (
            <span className="ml-2 text-[11px] font-normal text-ink-soft">util assumed</span>
          )}
        </span>
      ),
    },
    { header: 'Chairs', align: 'right', render: (r) => r.chairs },
    { header: 'Occupancy', align: 'right', render: (r) => `${r.occupancyPct}%` },
    { header: 'Booked/yr', align: 'right', render: (r) => `${r.bookedHrsYr.toLocaleString('en-GB')}h` },
    { header: 'Empty/yr', align: 'right', render: (r) => `${r.emptyHrsYr.toLocaleString('en-GB')}h` },
    { header: 'Cost of empty', align: 'right', render: (r) => formatPence(r.lostPotentialYrPence) },
    { header: 'Recoverable', align: 'right', render: (r) => formatPence(r.recoverRevYrPence) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Chair Efficiency"
        subtitle="Every chair as an asset — true occupancy against full capacity, the cost of empty chairs, and exactly how much to recover."
      />
      <ScopePeriodBar dentallyOnly />

      {isLoading && (
        <>
          <SkeletonKpiRow count={4} />
          <SkeletonTable rows={6} cols={5} />
        </>
      )}

      {isError && (
        <AlertRow tone="bad" title="Couldn't load chair analytics" body={(error as Error)?.message} />
      )}

      {data && !data.applicable && (
        <AlertRow
          tone="info"
          title="Chair analytics apply to clinical practices"
          body={data.message || 'Switch scope to the whole group or a single practice.'}
        />
      )}

      {data && data.applicable && data.group && (
        <>
          {(data.practices ?? []).some((p) => p.occupancySource === 'manual') && (
            <AlertRow
              tone="info"
              title="Occupancy from the chair-utilisation grid"
              body="Occupancy is your manually-maintained chair-utilisation data (booked ÷ available minutes). Revenue is real settled payments. Cost-of-empty-chairs and recoverable are modelled from occupancy and the practice chair count."
            />
          )}
          {(data.practices ?? []).some((p) => p.occupancySource === 'assumption') && (
            <AlertRow
              tone="warn"
              title="Some practices have no chair-utilisation data"
              body="Where the chair-utilisation grid is empty, occupancy falls back to a working assumption (80%) — fill the grid in Chair Utilisation to make those practices live."
            />
          )}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <KpiTile
              label="True chair occupancy"
              value={`${data.group.occupancyPct}%`}
              delta={`${(data.group.occupancyPct - (data.config?.benchOccPct ?? 88)).toFixed(1)}pts vs ${data.config?.benchOccPct ?? 88}% benchmark`}
              deltaTone={data.group.occupancyPct >= (data.config?.benchOccPct ?? 88) ? 'up' : 'down'}
            />
            <KpiTile
              label="Cost of empty chairs"
              value={formatPence(data.group.lostPotentialYrPence)}
              delta={`${data.group.emptyHrsYr.toLocaleString('en-GB')} empty hrs/yr at £${((data.config?.benchRevHrPence ?? 30000) / 100).toFixed(0)}/chair-hr`}
              deltaTone="down"
            />
            <KpiTile
              label={`Recoverable to ${data.config?.benchOccPct ?? 88}%`}
              value={formatPence(data.group.recoverRevYrPence)}
              delta="At your own revenue/hr, not the ceiling"
              deltaTone="up"
            />
          </div>

          {/* Recovery engine — server-authoritative; the uplift drives ?recover= */}
          <div className="card-padded">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="display text-lg">Chair Recovery Engine</h3>
                <p className="text-xs text-ink-muted mt-1">
                  Win back occupancy points and see the chair-hours + revenue it unlocks across the scope.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] uppercase tracking-wider text-ink-soft font-semibold">Uplift</label>
                <select
                  className="text-[13px] border border-border bg-card rounded-xl px-3 py-2"
                  value={recover}
                  onChange={(e) => setRecover(Number(e.target.value))}
                >
                  {UPLIFTS.map((u) => (
                    <option key={u} value={u}>{u}%</option>
                  ))}
                </select>
              </div>
            </div>
            {data.recovery && (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mt-4">
                <KpiTile label="Recovery chair-time" value={`${data.recovery.recoveryHrsYr.toLocaleString('en-GB')}h`} delta="per year, across scope" />
                <KpiTile label="Revenue unlocked" value={formatPence(data.recovery.revenueUnlockedPence)} delta="at your current yield/hr" deltaTone="up" />
                <KpiTile label="New occupancy" value={`${data.recovery.newOccupancyPct}%`} delta={`from ${data.group.occupancyPct}% today`} />
              </div>
            )}
          </div>

          <ChairConfigPanel />

          <div>
            <h3 className="display text-lg mb-2">Occupancy &amp; cost of empty chairs — by practice</h3>
            <DataTable
              columns={cols}
              rows={data.practices}
              rowKey={(r) => r.id}
              empty={<EmptyState message="No practices in scope." />}
            />
          </div>

          {data.note && <p className="text-[11px] text-ink-soft">{data.note}</p>}
        </>
      )}
    </div>
  );
}

// Capacity-assumptions editor (Phase 3 / T12). Persists the per-org chair_config
// that drives every capacity figure above. finance.edit gated server-side; on a
// 403 the Save just surfaces the error. Saving refetches the chair analytics so
// the KPIs update immediately.
const CFG_FIELDS: { key: keyof ChairConfig; label: string; suffix?: string; pence?: boolean; step?: number }[] = [
  { key: 'openHrs', label: 'Open hours / day', step: 0.5 },
  { key: 'weeksYr', label: 'Working weeks / year' },
  { key: 'daysWk', label: 'Working days / week' },
  { key: 'benchOccPct', label: 'Benchmark occupancy', suffix: '%' },
  { key: 'benchRevHrPence', label: 'Benchmark £/chair-hour', pence: true },
];

function ChairConfigPanel() {
  const { data: cfg } = useChairConfig();
  const save = useSaveChairConfig();
  const [form, setForm] = useState<ChairConfig | null>(null);

  // Seed the form once the saved config arrives (and re-seed after a save).
  useEffect(() => {
    if (cfg) setForm(cfg);
  }, [cfg]);

  if (!form) return null;

  // Display value: pence fields shown as whole pounds for editing.
  const shown = (f: typeof CFG_FIELDS[number]) =>
    f.pence ? Math.round((form[f.key] as number) / 100) : (form[f.key] as number);
  const onChange = (f: typeof CFG_FIELDS[number], raw: string) => {
    const n = Number(raw) || 0;
    setForm((s) => (s ? { ...s, [f.key]: f.pence ? Math.round(n * 100) : n } : s));
  };

  return (
    <div className="card-padded">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="display text-lg">Capacity assumptions</h3>
          <p className="text-xs text-ink-muted mt-1">
            The operating standards behind every capacity figure on this screen.
            {cfg?.isDefault && ' Currently using the UK-standard defaults.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            {save.isError
              ? 'Save failed — you may not have edit permission.'
              : save.isSuccess
                ? 'Saved.'
                : cfg?.updatedAt
                  ? `Last saved ${new Date(cfg.updatedAt).toLocaleDateString('en-GB')}`
                  : ''}
          </span>
          <button
            onClick={() => form && save.mutate(form)}
            disabled={save.isPending}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--brand)' }}
          >
            {save.isPending ? 'Saving…' : 'Save assumptions'}
          </button>
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5 mt-4">
        {CFG_FIELDS.map((f) => (
          <label key={String(f.key)} className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-ink-soft font-semibold">{f.label}</span>
            <div className="flex items-center gap-1">
              {f.pence && <span className="text-sm text-ink-muted">£</span>}
              <input
                type="number"
                step={f.step ?? 1}
                min={0}
                value={shown(f)}
                onChange={(e) => onChange(f, e.target.value)}
                className="w-full text-[13px] border border-border bg-card rounded-xl px-3 py-2"
              />
              {f.suffix && <span className="text-sm text-ink-muted">{f.suffix}</span>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
