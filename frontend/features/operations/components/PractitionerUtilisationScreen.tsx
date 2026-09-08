'use client';
// Practitioner Utilisation — how full the chairs are, and what that is worth.
//
// Three views of ONE server-side aggregate, so they cannot contradict each
// other: headline cards, the availability-vs-usage area chart, and the
// practitioner × day grid.
//
// WHAT THE NUMBERS MEAN, because two of the decisions behind them are
// judgement calls and the screen says so rather than hoping nobody asks:
//
//   available   the practitioner's booked day span, first appointment to last.
//               Dentally exposes no roster (probed: no working hours on
//               /practitioners, ten candidate endpoints 404, and the one that
//               exists refuses a past date), so this is a proxy — a good one,
//               averaging 7.9 hours, which is a working day.
//   utilised    appointments with a PATIENT attached. Blocks, meetings and
//               holidays are unused time, per Dentally's own definition.
//   unavailable a day whose diary held ONLY blocks. 180 of 234 such days in a
//               sample week carried 1,440 of 1,837 "available" hours; counting
//               them reads 15.3% where the working days read 70.7%. A
//               clinician who was not in is not one who sat idle.

import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, DataTable, EmptyState, KpiTile, PageHeader, Skeleton, type Column } from '@/components/ui';
import { money, DASH } from '@/features/marketing/_shared/format';
import { usePractitionerUtilisation } from '../practitioner-utilisation-hooks';
import { usePractices } from '@/features/integrations/hooks';
import type { UtilPractitioner, UtilPractitionerDay } from '../practitioner-utilisation-api';

// Dentally's own bands, so a practice reading both sees the same colours mean
// the same thing. Purple is over-booked, not "best".
const BANDS = [
  { min: 100, label: '> 100%', colour: '#3B1E54' },
  { min: 80, label: '> 80% – 100%', colour: '#2E6E8E' },
  { min: 60, label: '> 60% – 80%', colour: '#1B9C8A' },
  { min: 40, label: '> 40% – 60%', colour: '#4FBF7F' },
  { min: 20, label: '> 20% – 40%', colour: '#8FD14F' },
  { min: 0, label: '0% – 20%', colour: '#F5D547' },
];

function bandColour(pct: number | null): string | null {
  if (pct === null) return null;
  return BANDS.find((b) => pct > b.min || (b.min === 0 && pct >= 0))?.colour ?? BANDS[BANDS.length - 1].colour;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday: immune to DST shifting the date
  d.setDate(d.getDate() - n);
  return ymd(d);
}

const RANGES = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'] | 'custom';

/** Short day label for a column header: "M 08". */
function dayLabel(iso: string): { dow: string; dom: string } {
  const d = new Date(`${iso}T12:00:00`);
  return {
    dow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
    dom: String(d.getDate()).padStart(2, '0'),
  };
}

const pct = (v: number | null) => (v === null ? DASH : `${v.toFixed(0)}%`);

/** "7h 15m" — hours and minutes, the way a diary is read. Negative bookable
 *  time is real (an over-booked day) and keeps its sign rather than clamping,
 *  because clamping would hide double-booking. */
function hm(hours: number): string {
  const neg = hours < 0;
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${neg ? '-' : ''}${h}h ${m}m`;
}

/** A long date, as Dentally writes it: 25/09/2026. */
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

type HoverCell = {
  practitionerName: string;
  practiceName: string | null;
  day: UtilPractitionerDay;
  x: number;
  y: number;
};
const hrs = (v: number | null | undefined) =>
  (v === null || v === undefined ? DASH : `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}h`);

export default function PractitionerUtilisationScreen() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Practice-wise. Null = every practice this organisation has; the filter is
  // passed to SQL, so the cards, the chart and the grid all narrow together
  // rather than the grid alone.
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverCell | null>(null);

  const { data: practicesData } = usePractices();
  const practices = practicesData?.practices ?? [];
  const practiceName = useMemo(
    () => new Map(practices.map((p: { id: string; name: string }) => [p.id, p.name])),
    [practices],
  );

  const { since, until } = useMemo(() => {
    if (range === 'custom' && customFrom && customTo) return { since: customFrom, until: customTo };
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    return { since: daysAgo(days), until: daysAgo(0) };
  }, [range, customFrom, customTo]);

  const { data, isLoading, error, isFetching } = usePractitionerUtilisation({ since, until, practiceId });

  const t = data?.totals;
  const days = data?.days ?? [];
  const practitioners = data?.practitioners ?? [];

  // Every day that appears anywhere, so the grid's columns are the window and
  // not just the days one practitioner happened to work.
  const allDays = useMemo(() => {
    const set = new Set<string>();
    for (const p of practitioners) for (const d of p.days) set.add(d.day);
    for (const d of days) set.add(d.day);
    return [...set].sort();
  }, [practitioners, days]);

  // The whole day row, not just its percentage: the hover card reports used,
  // bookable and total time, and re-deriving those from a percentage would
  // lose the minutes.
  const cells = useMemo(() => {
    const m = new Map<string, Map<string, UtilPractitionerDay>>();
    for (const p of practitioners) {
      m.set(p.practitionerId, new Map(p.days.map((d) => [d.day, d])));
    }
    return m;
  }, [practitioners]);

  // Daily total: a RATIO OF SUMS from the server, not a mean of the cells
  // above it. Averaging the column would let a 45-minute list count as much as
  // a nine-hour one.
  const dailyTotal = useMemo(
    () => new Map(days.map((d) => [d.day, d.utilisationPct])),
    [days],
  );

  const leagueColumns: Column<UtilPractitioner>[] = useMemo(() => [
    { header: 'Practitioner', render: (p) => <strong className="text-[13px]">{p.practitionerName}</strong> },
    // The site they worked most in this window. Shown only when the
    // organisation has more than one, and never blank: an unmapped day says so
    // rather than leaving a gap that reads as missing data.
    ...(practices.length > 1
      ? [{
          header: 'Practice',
          render: (p: UtilPractitioner) => (
            <span className="text-ink-muted">
              {p.practiceId ? (practiceName.get(p.practiceId) ?? 'Unknown site') : 'Not mapped'}
            </span>
          ),
        } as Column<UtilPractitioner>]
      : []),
    {
      header: 'Utilisation',
      render: (p) => (
        <span className="font-semibold tabular-nums" style={{ color: bandColour(p.utilisationPct) ?? 'var(--ink-muted)' }}>
          {pct(p.utilisationPct)}
        </span>
      ),
    },
    { header: 'Days', render: (p) => <span className="tabular-nums">{p.daysWorked}</span> },
    { header: 'Used', render: (p) => <span className="tabular-nums">{hrs(p.utilisedHours)}</span> },
    { header: 'Available', render: (p) => <span className="tabular-nums">{hrs(p.availableHours)}</span> },
    { header: 'Patients', render: (p) => <span className="tabular-nums">{p.patientAppts.toLocaleString('en-GB')}</span> },
    // money() renders null as an em dash — a practitioner with no invoicing
    // has no rate, and "£0.00/h" would be a figure nobody recorded.
    { header: 'Fees', render: (p) => <span className="tabular-nums">{money(p.revenuePence)}</span> },
    { header: 'Per used hour', render: (p) => <span className="tabular-nums">{money(p.revenuePerUtilisedHourPence)}</span> },
  ], [practices.length, practiceName]);

  return (
    <div className="mx-auto w-full space-y-4" style={{ maxWidth: 1600 }}>
      <PageHeader
        title="Practitioner utilisation"
        subtitle={isLoading || !t
          ? 'Loading utilisation…'
          : `${t.practitioners} practitioners · ${t.daysWorked.toLocaleString('en-GB')} working days · `
            + `${hrs(t.utilisedHours)} of ${hrs(t.availableHours)} used`}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border bg-card px-3 py-2.5">
        <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="util-range">Period</label>
        <select
          id="util-range"
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
        >
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {range === 'custom' && (
          <>
            <input type="date" value={customFrom} max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date"
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-[13px]" />
            <span className="text-ink-muted text-xs">to</span>
            <input type="date" value={customTo} min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)} aria-label="To date"
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-[13px]" />
            {(!customFrom || !customTo) && (
              <span className="text-ink-muted text-[11px]">Pick both dates</span>
            )}
          </>
        )}
        {/* PRACTICE-WISE. Only offered when the organisation actually has more
            than one site — a lone "All practices" pill is a control with
            nothing to control. */}
        {practices.length > 1 && (
          <>
            <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="util-practice">Practice</label>
            <select
              id="util-practice"
              value={practiceId ?? ''}
              onChange={(e) => setPracticeId(e.target.value || null)}
              className="max-w-[260px] truncate rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
            >
              <option value="">All practices</option>
              {practices.map((p: { id: string; name: string }) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}

        <span className="text-ink-muted ml-auto text-[11px]">
          {since} → {until}{isFetching ? ' · updating…' : ''}
        </span>
      </div>

      {error && (
        // A named failure, never a silent empty state.
        <div className="card" style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Could not load utilisation: {(error as Error).message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Chair utilisation"
          value={t ? pct(t.utilisationPct) : DASH}
          delta={t ? `${hrs(t.utilisedHours)} used of ${hrs(t.availableHours)}` : undefined}
          info="Patient-appointment time divided by the practitioners' booked day span, pooled across every working day in the window. A ratio of sums, not an average of daily percentages — averaging lets a 45-minute list count as much as a nine-hour one."
        />
        <KpiTile
          label="Unused chair time"
          value={t ? hrs(t.unusedHours) : DASH}
          delta={t && t.unusedHoursValuePence !== null
            ? `worth ~${money(t.unusedHoursValuePence)} at your own rate`
            : undefined}
          deltaTone="down"
          info="Available time with no patient in it. Valued at the fees this practice actually achieves per used hour — an arithmetic restatement of the gap, not a target or a promise."
        />
        <KpiTile
          label="Fees per used hour"
          value={t ? money(t.revenuePerUtilisedHourPence) : DASH}
          delta={t && t.revenuePerAvailableHourPence !== null
            ? `${money(t.revenuePerAvailableHourPence)} per available hour`
            : undefined}
          info="Fees invoiced by these practitioners in the window, divided by the hours they spent with patients. The second figure spreads the same fees across all available hours, which is what the practice actually earns on the time it opens."
        />
        <KpiTile
          label="Patient appointments"
          value={t ? t.patientAppts.toLocaleString('en-GB') : DASH}
          delta={t && t.revenuePence !== null ? `${money(t.revenuePence)} invoiced` : undefined}
          info="Appointments with a patient attached. Blocks, meetings and holidays are excluded — they are unused time, not utilisation."
        />
      </div>

      {/* The exclusion, stated. A headline that quietly dropped four fifths of
          the diary would be indistinguishable from one that did not. */}
      {data && data.excluded.blockOnlyDays > 0 && (
        <div className="text-ink-muted rounded-panel border border-border bg-card px-3 py-2 text-[12px]">
          <strong>{data.excluded.blockOnlyDays.toLocaleString('en-GB')}</strong> practitioner-days
          {' '}({hrs(data.excluded.blockOnlyHours)} across {data.excluded.practitioners} practitioners)
          {' '}held only blocks, meetings or holidays and no patients. They are counted as
          {' '}<strong>not working</strong> rather than 0% utilised — Dentally exposes no rota, so a
          {' '}diary with no patients in it cannot tell us the clinician was rostered.
        </div>
      )}

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">Chair time availability and usage</h2>
          <p className="text-ink-muted text-[12px]">
            Green is time with a patient in the chair; the band above it is available time left empty.
          </p>
        </div>
        <div className="p-3" style={{ height: 320 }}>
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : days.length === 0 ? (
            <EmptyState message="No working days in this window." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={days} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--ink-muted)" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--ink-muted)"
                  label={{ value: 'Hours', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v}h`, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
                />
                {/* Stacked: used + unused = available, so the top of the band
                    IS the available line. Drawing availability as its own
                    overlapping area would let the two disagree visually. */}
                <Area type="monotone" dataKey="utilisedHours" name="Used" stackId="1"
                  stroke="#1B9C8A" fill="#1B9C8A" fillOpacity={0.85} />
                <Area type="monotone" dataKey="unusedHours" name="Unused" stackId="1"
                  stroke="#F0A93B" fill="#F0A93B" fillOpacity={0.55} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">Utilisation by practitioner and day</h2>
          <p className="text-ink-muted text-[12px]">
            A blank cell means the practitioner had no patient appointments that day.
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : practitioners.length === 0 ? (
          <EmptyState message="No practitioner activity in this window." />
        ) : (
          <div className="relative p-3">
            {/* The grid SCROLLS, in both directions, with the practitioner
                column, the date header and the Total row all frozen. A month
                of columns across forty practitioners is neither a wide table
                nor a tall one — it is both, and losing either axis while
                reading a cell makes the cell meaningless. */}
            <div
              className="crm-board-scroll overflow-auto"
              style={{ maxHeight: 460 }}
              onMouseLeave={() => setHover(null)}
            >
              <table className="border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th
                      className="text-ink-muted sticky left-0 top-0 z-30 bg-card px-2 text-right text-[11px] font-semibold"
                      style={{ minWidth: 160 }}
                    >
                      Practitioner
                    </th>
                    {allDays.map((d) => {
                      const { dow, dom } = dayLabel(d);
                      return (
                        <th
                          key={d}
                          className="text-ink-muted sticky top-0 z-20 bg-card px-1 text-center text-[10px] font-semibold"
                          style={{ minWidth: 32 }}
                        >
                          <div>{dow}</div>
                          <div className="tabular-nums">{dom}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {practitioners.map((p) => (
                    <tr key={p.practitionerId}>
                      <td
                        className="sticky left-0 z-10 truncate bg-card px-2 text-right text-[12px] font-medium"
                        title={p.practitionerName}
                        style={{ maxWidth: 200 }}
                      >
                        {p.practitionerName}
                      </td>
                      {allDays.map((d) => {
                        const cell = cells.get(p.practitionerId)?.get(d) ?? null;
                        const c = bandColour(cell?.utilisationPct ?? null);
                        return (
                          <td key={d} className="text-center" style={{ width: 32, height: 28 }}>
                            <div
                              // Hover AND focus: the grid is keyboard-navigable,
                              // and a card only a mouse can open is a card half
                              // the people here cannot read.
                              tabIndex={cell ? 0 : -1}
                              onMouseEnter={(e) => {
                                if (!cell) return setHover(null);
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setHover({
                                  practitionerName: p.practitionerName,
                                  practiceName: practiceName.get(cell.practiceId ?? '') ?? null,
                                  day: cell,
                                  x: r.left + r.width / 2,
                                  y: r.top,
                                });
                              }}
                              onFocus={(e) => {
                                if (!cell) return;
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setHover({
                                  practitionerName: p.practitionerName,
                                  practiceName: practiceName.get(cell.practiceId ?? '') ?? null,
                                  day: cell,
                                  x: r.left + r.width / 2,
                                  y: r.top,
                                });
                              }}
                              onBlur={() => setHover(null)}
                              className="flex h-[28px] w-full cursor-default items-center justify-center rounded text-[9px] font-bold transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                              style={{
                                background: c ?? 'var(--bg)',
                                color: c ? 'white' : 'var(--ink-muted)',
                              }}
                            >
                              {cell === null ? '\u00d7' : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Frozen to the bottom, like the header to the top: the
                      daily total is the row people scan against, and it is
                      useless once it has scrolled away. */}
                  <tr>
                    <td className="sticky bottom-0 left-0 z-30 bg-card px-2 text-right text-[11px] font-bold">
                      Total utilisation %
                    </td>
                    {allDays.map((d) => {
                      const v = dailyTotal.get(d) ?? null;
                      return (
                        <td
                          key={d}
                          className="sticky bottom-0 z-20 bg-card text-center text-[10px] font-semibold tabular-nums"
                          style={{ width: 32 }}
                        >
                          {v === null ? DASH : v.toFixed(0)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
              {BANDS.map((b) => (
                <span key={b.label} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ background: b.colour }} />
                  {b.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="text-ink-muted inline-block h-3 w-3 rounded text-center text-[9px] leading-3" style={{ background: 'var(--bg)' }}>
                  &times;
                </span>
                Practitioner unavailable
              </span>
            </div>

            {/* The hover card, positioned against the viewport so it is never
                clipped by the scroller it sits inside. `pointer-events-none`
                so it can never steal the hover that produced it. */}
            {hover && (
              <div
                role="tooltip"
                className="pointer-events-none fixed z-50 rounded-panel border border-border bg-card px-3 py-2 text-[12px] shadow-panel"
                style={{
                  left: Math.min(Math.max(hover.x - 130, 8), (typeof window !== 'undefined' ? window.innerWidth : 1200) - 268),
                  top: Math.max(hover.y - 118, 8),
                  width: 260,
                }}
              >
                <div className="font-semibold">
                  {hover.practitionerName}
                  {hover.practiceName ? ` (${hover.practiceName})` : ''}
                </div>
                <div className="text-ink-muted mb-1.5 text-[11px]">{ddmmyyyy(hover.day.day)}</div>
                <dl className="space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Utilised time</dt>
                    <dd className="font-semibold tabular-nums">{hm(hover.day.utilisedHours)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Bookable time</dt>
                    {/* Total minus utilised. Negative on an over-booked day,
                        and it keeps the sign — clamping at zero would hide
                        double-booking, which is the thing worth seeing. */}
                    <dd className="font-semibold tabular-nums"
                      style={{ color: hover.day.availableHours - hover.day.utilisedHours < 0 ? 'var(--danger)' : undefined }}>
                      {hm(hover.day.availableHours - hover.day.utilisedHours)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Total time</dt>
                    <dd className="font-semibold tabular-nums">{hm(hover.day.availableHours)}</dd>
                  </div>
                  <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1">
                    <dt className="text-ink-muted">Patients</dt>
                    <dd className="font-semibold tabular-nums">{hover.day.patientAppts}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Fees</dt>
                    <dd className="font-semibold tabular-nums">{money(hover.day.revenuePence)}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">Practitioner performance</h2>
          <p className="text-ink-muted text-[12px]">
            Ordered by utilisation. Fees are what each practitioner invoiced in this window.
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : practitioners.length === 0 ? (
          <EmptyState message="No practitioner activity in this window." />
        ) : (
          <DataTable columns={leagueColumns} rows={practitioners} rowKey={(p) => p.practitionerId} />
        )}
      </Card>
    </div>
  );
}
