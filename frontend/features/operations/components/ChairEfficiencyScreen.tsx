'use client';

// Chair Efficiency — every chair as an asset: how much of its open time is
// booked, what the empty time costs, and what filling it is worth.
//
// Capacity comes from the practice's REAL opening hours (synced from Dentally)
// times its chairs, and occupancy from the cells actually entered against that
// availability. Both figures come from the same cells, which is what makes them
// reconcile — they used not to, and the mismatch produced a GBP 230,041
// "recoverable" claim off 14% of one practice's week.
//
// EVERY money figure here can be null, and null must render as an em dash. It
// means "not enough of the week has been described to say", which is the
// opposite of the GBP 0 that formatPence would happily print.

import { useEffect, useState } from 'react';
import {
  PageHeader, KpiTile, DataTable, EmptyState, AlertRow, SkeletonKpiRow, SkeletonTable,
  Explainer, type Column,
} from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { formatPence } from '@/lib/format';
import { useChairAnalytics } from '../chair-analytics-hooks';
import type { ChairPracticeRow } from '../chair-analytics-api';
import { useChairConfig, useSaveChairConfig } from '../chair-config-hooks';
import type { ChairConfig } from '../chair-config-api';

const UPLIFTS = [0, 5, 10, 20, 40];
const DASH = '—';

/** A cost per nothing is unknowable, not free. formatPence renders null as
 *  "£0.00" without a type error, so the guard lives here, at the call site. */
const money = (pence: number | null | undefined) =>
  pence == null ? DASH : formatPence(pence);
const percent = (pct: number | null | undefined) =>
  pct == null ? DASH : `${pct}%`;
const hours = (h: number | null | undefined) =>
  h == null ? DASH : `${h.toLocaleString('en-GB')}h`;

export function ChairEfficiencyScreen() {
  const [recover, setRecover] = useState(10);
  const [tableInfo, setTableInfo] = useState(false);
  const { data, isLoading, isError, error } = useChairAnalytics(recover);

  const threshold = data?.coverageThresholdPct ?? 50;
  const benchOcc = data?.config?.benchOccPct ?? 88;
  const benchRate = (data?.config?.benchRevHrPence ?? 30000) / 100;

  const cols: Column<ChairPracticeRow>[] = [
    {
      header: 'Practice',
      render: (r) => (
        <div>
          <span className="font-semibold">{r.name}</span>
          <div className="text-ink-muted text-[11px] mt-0.5">
            {/* Three distinct states, three different fixes. Collapsing them
                would send an owner to the wrong screen. */}
            {!r.hasOpeningHours
              ? 'No opening hours set'
              : r.chairs === 0
                ? 'No chairs added yet'
                : `${r.enteredCells} of ${r.openCells} slots entered`}
          </div>
        </div>
      ),
    },
    { header: 'Chairs', align: 'right', render: (r) => r.chairs || DASH },
    { header: 'Occupancy', align: 'right', render: (r) => percent(r.occupancyPct) },
    { header: 'Booked/yr', align: 'right', render: (r) => hours(r.bookedHrsYr) },
    { header: 'Empty/yr', align: 'right', render: (r) => hours(r.emptyHrsYr) },
    { header: 'Cost of empty', align: 'right', render: (r) => money(r.lostPotentialYrPence) },
    { header: 'Recoverable', align: 'right', render: (r) => money(r.recoverRevYrPence) },
  ];

  const noHours = (data?.practices ?? []).filter((p) => !p.hasOpeningHours);
  // Hours but no chairs: a different problem with a different fix, so it gets
  // its own banner rather than being folded into "no opening hours".
  const noChairs = (data?.practices ?? []).filter((p) => p.hasOpeningHours && p.chairs === 0);
  const thin = (data?.practices ?? []).filter(
    (p) => p.hasOpeningHours && p.chairs > 0 && (p.coveragePct ?? 0) < threshold,
  );
  const overbooked = (data?.practices ?? []).filter((p) => p.overbookedCells > 0);
  const closedEntries = (data?.practices ?? []).filter((p) => p.closedCellEntries > 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Chair Efficiency"
        subtitle="Every chair as an asset — how much of its open time is booked, what the empty time costs, and what filling it is worth."
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
          {noHours.length > 0 && (
            <AlertRow
              tone="warn"
              title={`${noHours.length} practice${noHours.length > 1 ? 's have' : ' has'} no opening hours`}
              body={`Without opening hours there is no chair time to measure against, so ${noHours.map((p) => p.name).join(', ')} ${noHours.length > 1 ? 'read' : 'reads'} as blank rather than zero. Set them in Chair Utilisation, or connect the practice to Dentally and they arrive automatically.`}
            />
          )}
          {noChairs.length > 0 && (
            <AlertRow
              tone="info"
              title={`${noChairs.length} practice${noChairs.length > 1 ? 's have' : ' has'} opening hours but no chairs yet`}
              body={`${noChairs.map((p) => p.name).join(', ')} — we know when they are open, but not how many surgeries they run, so there is no capacity to measure. Add the chairs in Chair Utilisation.`}
            />
          )}
          {thin.length > 0 && (
            <AlertRow
              tone="info"
              title="Some practices have described only part of their week"
              body={`Occupancy is shown for ${thin.map((p) => p.name).join(', ')}, but the yearly money figures are held back below ${threshold}% coverage — an annual pound figure based on a couple of slots would be a guess dressed as a number. Fill in more of the week in Chair Utilisation.`}
            />
          )}
          {overbooked.length > 0 && (
            <AlertRow
              tone="warn"
              title="Some slots record more booked time than the practice is open"
              body={`${overbooked.map((p) => `${p.name} (${p.overbookedCells})`).join(', ')}. Those slots are capped at 100% here. Check them in Chair Utilisation — usually the opening hours changed after the figures were entered.`}
            />
          )}
          {closedEntries.length > 0 && (
            <AlertRow
              tone="info"
              title="Some entries sit in slots the practice is now closed for"
              body={`${closedEntries.map((p) => `${p.name} (${p.closedCellEntries})`).join(', ')}. They are excluded from every figure. If the practice does open then, correct its opening hours.`}
            />
          )}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <KpiTile
              label="Chair occupancy"
              value={percent(data.group.occupancyPct)}
              delta={
                data.group.occupancyPct == null
                  ? 'Not enough entered yet'
                  : `${(data.group.occupancyPct - benchOcc).toFixed(1)}pts vs ${benchOcc}% benchmark`
              }
              deltaTone={
                data.group.occupancyPct == null ? undefined
                  : data.group.occupancyPct >= benchOcc ? 'up' : 'down'
              }
              info={
                <Explainer
                  what="How much of your open chair time is actually booked."
                  how="We add up the hours booked and divide by the hours those chairs are open, using your real opening hours. Only slots you have filled in count, and the figure beside it says how many that is."
                  now={
                    data.group.occupancyPct == null
                      ? <>Nothing has been entered yet, so there is no occupancy to show — not 0%.</>
                      : <>Your chairs are <b>{data.group.occupancyPct}% full</b> across the {data.group.enteredCells} slot{data.group.enteredCells === 1 ? '' : 's'} you have described, out of {data.group.openCells} you are open for.</>
                  }
                />
              }
            />
            <KpiTile
              label="Cost of empty chairs"
              value={money(data.group.lostPotentialYrPence)}
              delta={
                data.group.lostPotentialYrPence == null
                  ? `Held back below ${threshold}% coverage`
                  : `${data.group.emptyHrsYr.toLocaleString('en-GB')} empty hrs/yr at £${benchRate.toFixed(0)}/chair-hr`
              }
              deltaTone={data.group.lostPotentialYrPence == null ? undefined : 'down'}
              info={
                <Explainer
                  what="The money you miss out on because chairs sit open but unbooked."
                  how={<>We count the empty chair-hours across the slots you have described, over a year, and value each at the £{benchRate.toFixed(0)} industry rate — what a chair <i>could</i> earn, not your own prices.</>}
                  now={
                    data.group.lostPotentialYrPence == null
                      ? <>Held back: less than {threshold}% of your open week has been entered, and a yearly figure from a fraction of a week would be a guess rather than a measurement.</>
                      : <><b>{data.group.emptyHrsYr.toLocaleString('en-GB')} empty hours</b> a year × £{benchRate.toFixed(0)} = <b>{money(data.group.lostPotentialYrPence)}</b>.</>
                  }
                />
              }
            />
            <KpiTile
              label={`Recoverable to ${benchOcc}%`}
              value={money(data.group.recoverRevYrPence)}
              delta={
                data.group.recoverRevYrPence == null
                  ? `Held back below ${threshold}% coverage`
                  : 'At your own revenue/hr, not the ceiling'
              }
              deltaTone={data.group.recoverRevYrPence == null ? undefined : 'up'}
              info={
                <Explainer
                  what={<>The extra revenue from filling chairs up to your {benchOcc}% target.</>}
                  how={<>We work out the extra hours needed to hit the target and value them at <b>your own</b> earnings per booked hour — a realistic figure, not the industry rate.</>}
                  now={
                    data.group.recoverRevYrPence == null
                      ? <>Held back until more of the week is entered.</>
                      : <>Going from {percent(data.group.occupancyPct)} to {benchOcc}% is worth about <b>{money(data.group.recoverRevYrPence)}</b> a year. This is £0 if you are already at or above target.</>
                  }
                />
              }
            />
          </div>

          {/* Recovery engine — server-authoritative; the uplift drives ?recover= */}
          <div className="card-padded">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="display text-lg">Chair Recovery Engine</h3>
                <p className="text-xs text-ink-muted mt-1">
                  Win back occupancy points and see the chair-hours and revenue it unlocks.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] uppercase tracking-wider text-ink-soft font-semibold">Uplift</label>
                <select
                  className="text-[13px] border border-border bg-card rounded-xl px-3 py-2"
                  value={recover}
                  onChange={(e) => setRecover(Number(e.target.value))}
                >
                  {UPLIFTS.map((u) => <option key={u} value={u}>{u}%</option>)}
                </select>
              </div>
            </div>
            {data.recovery ? (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mt-4">
                <KpiTile
                  label="Recovery chair-time"
                  value={hours(data.recovery.recoveryHrsYr)}
                  delta="per year, across scope"
                  info={
                    <Explainer
                      what="The extra chair-hours you would gain each year at the uplift you picked."
                      how={<>We add your chosen {recover}% on top of today&apos;s occupancy — never past 100%, because you cannot book more than every open hour.</>}
                      now={<>A {recover}% lift on {percent(data.group.occupancyPct)} gives <b>{hours(data.recovery.recoveryHrsYr)}</b> more a year.</>}
                    />
                  }
                />
                <KpiTile
                  label="Revenue unlocked"
                  value={money(data.recovery.revenueUnlockedPence)}
                  delta="at your current yield/hr"
                  deltaTone="up"
                  info={
                    <Explainer
                      what="The money those extra booked hours would bring in."
                      how="We multiply the extra chair-hours by your own average earnings per booked hour."
                      now={<><b>{hours(data.recovery.recoveryHrsYr)}</b> at your own yield = <b>{money(data.recovery.revenueUnlockedPence)}</b> a year.</>}
                    />
                  }
                />
                <KpiTile
                  label="New occupancy"
                  value={percent(data.recovery.newOccupancyPct)}
                  delta={`from ${percent(data.group.occupancyPct)} today`}
                  info={
                    <Explainer
                      what="Where your occupancy would land after the uplift."
                      how="Today's occupancy plus the uplift you chose, capped at 100%."
                      now={<>{percent(data.group.occupancyPct)} + up to {recover}% = <b>{percent(data.recovery.newOccupancyPct)}</b>.</>}
                    />
                  }
                />
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted mt-4">
                There is no occupancy to recover from yet. Enter a week in Chair Utilisation and
                this will fill in.
              </p>
            )}
          </div>

          <ChairConfigPanel />

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="display text-lg">Occupancy &amp; cost of empty chairs — by practice</h3>
              <button
                type="button"
                onClick={() => setTableInfo((o) => !o)}
                aria-label={tableInfo ? 'Hide column definitions' : 'How are these columns calculated?'}
                aria-expanded={tableInfo}
                className="shrink-0 w-5 h-5 rounded-full border border-border text-[11px] font-semibold text-ink-muted leading-none flex items-center justify-center hover:bg-surface-muted"
              >
                {tableInfo ? '×' : '?'}
              </button>
            </div>
            {tableInfo && (
              <div className="card-padded mb-2 text-[12px] text-ink-muted leading-relaxed">
                <div className="font-semibold text-ink mb-1">What each column means</div>
                <ul className="list-disc pl-4 flex flex-col gap-1">
                  <li><b>Chairs</b> — the surgeries set up for this practice in Chair Utilisation.</li>
                  <li><b>Occupancy</b> — booked time as a share of open time, across the slots entered.</li>
                  <li><b>Booked/yr</b> — those booked hours across a whole year.</li>
                  <li><b>Empty/yr</b> — open chair-hours left unbooked, over the same slots.</li>
                  <li><b>Cost of empty</b> — what those empty hours would be worth at the £{benchRate.toFixed(0)}/hr industry rate.</li>
                  <li><b>Recoverable</b> — extra revenue from reaching your {benchOcc}% target, at your own prices.</li>
                  <li><b>{DASH}</b> — not enough of that practice&apos;s week has been entered to say. It does not mean zero.</li>
                </ul>
              </div>
            )}
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

// Capacity assumptions. openHrs and daysWk no longer drive capacity — real
// opening hours do — so this panel now edits only what remains a genuine
// assumption: how many weeks a year you work, and the two benchmarks.
const CFG_FIELDS: { key: keyof ChairConfig; label: string; suffix?: string; pence?: boolean; step?: number }[] = [
  { key: 'weeksYr', label: 'Working weeks / year' },
  { key: 'benchOccPct', label: 'Benchmark occupancy', suffix: '%' },
  { key: 'benchRevHrPence', label: 'Benchmark £/chair-hour', pence: true },
];

function ChairConfigPanel() {
  const { data: cfg } = useChairConfig();
  const save = useSaveChairConfig();
  const [form, setForm] = useState<ChairConfig | null>(null);

  useEffect(() => {
    if (cfg) setForm(cfg);
  }, [cfg]);

  if (!form) return null;

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
            Open hours come from each practice&apos;s own opening hours, so they are not set here.
            These are the assumptions that remain.
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
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 mt-4">
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
