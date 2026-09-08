'use client';
// Practitioner Performance — cards and charts, group first, then one clinician.
//
// SHAPED LIKE THE BUSINESS HUB on purpose, and using its own components rather
// than lookalikes: SectionLabel and HeadlineCard come from
// features/overview/components/HeadlineCard. A copy would be free to drift, and
// it already has once — the QuickBooks panel carried its own tiles and rendered
// its values in a different typeface from every other tile on the page.
//
// TWO LEVELS, one control. The group answers "how are we doing"; picking a
// clinician answers "how are they doing", and both are drawn from the SAME
// server aggregate, so a practitioner's card can never disagree with the group
// total it is part of.
//
// WHY A BAR CHART AND NOT A LEAGUE TABLE. A table sorts, which invites reading
// the top row as "best". These four measures disagree about who is best — the
// fullest diary is rarely the most productive one — so the comparison is drawn
// as bars against a chosen measure, with the group average marked, and the
// reader can see the spread instead of a ranking.
//
// NULL IS NOT ZERO, everywhere. A rate with no denominator renders as an em
// dash, and a day we hold no rota for is a GAP in the line, not a point at
// zero: money() and a recharts line will both happily draw a confident zero
// from a null with no warning at all.

import { useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { SectionLabel, HeadlineCard, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import { money, DASH } from '@/features/marketing/_shared/format';
import { usePractitionerPerformance } from '../practitioner-performance-hooks';
import { usePractices } from '@/features/integrations/hooks';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { previousPeriod } from '@/features/marketing/_shared/compare';
import { useScopePeriod, londonYmd } from '@/features/_shared/scope-context';
import type { UtilBasis } from '../practitioner-utilisation-api';
import type { PerfPractitioner } from '../practitioner-performance-api';

const hrs = (v: number | null | undefined) =>
  (v === null || v === undefined ? DASH : `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}h`);
const pct = (v: number | null | undefined) =>
  (v === null || v === undefined ? DASH : `${v.toFixed(1)}%`);
const num = (v: number | null | undefined) =>
  (v === null || v === undefined ? DASH : v.toLocaleString('en-GB'));
const dec = (v: number | null | undefined) =>
  (v === null || v === undefined ? DASH : v.toLocaleString('en-GB', { maximumFractionDigits: 1 }));

// Dentally's own utilisation bands, so the same figure means the same thing on
// both screens and in their software. Purple is OVER-booked, not "best".
function utilTone(v: number | null): string {
  if (v === null) return '#9CA3AF';
  if (v > 100) return '#3B1E54';
  if (v > 80) return '#2E6E8E';
  if (v > 60) return '#1B9C8A';
  if (v > 40) return '#4FBF7F';
  if (v > 20) return '#8FD14F';
  return '#F5D547';
}

/** "2026-09-01" -> "1 Sep", for an axis that has to fit a month of them. */
const shortDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
};

type Measure = 'revenuePence' | 'utilisationPct' | 'utilisedHours' | 'treatments' | 'revenuePerUtilisedHourPence';

const MEASURES: { key: Measure; label: string; format: (v: number | null) => string; money?: boolean }[] = [
  { key: 'revenuePence', label: 'Fees invoiced', format: money, money: true },
  { key: 'revenuePerUtilisedHourPence', label: 'Fees per used hour', format: money, money: true },
  { key: 'utilisationPct', label: 'Utilisation', format: pct },
  { key: 'utilisedHours', label: 'Hours used', format: hrs },
  { key: 'treatments', label: 'Treatments completed', format: num },
];

export default function PractitionerPerformanceScreen() {
  const { win, scope } = useScopePeriod();
  const since = londonYmd(win.since);
  // The shared window is HALF-OPEN [since, until); this endpoint's `until` is an
  // INCLUSIVE London date. Step back one MILLISECOND, not one day — at midnight
  // on the 1st those differ, and a whole day would be lost the same way the
  // Facebook funnel lost every month's last day.
  const until = londonYmd(new Date(Date.parse(win.until) - 1).toISOString());
  const practiceId = scope && scope !== 'all' ? scope : null;

  // Defaults to the rota: the only denominator that is Dentally's own rather
  // than inferred from the diary.
  const [basis, setBasis] = useState<UtilBasis>('rota');
  const [measure, setMeasure] = useState<Measure>('revenuePence');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ALWAYS ON, against the equal-length period immediately before this one —
  // the Business Hub behaviour. A comparison behind a button is a comparison
  // nobody makes, and the figure it guards is the one that says whether a
  // month is going well.
  //
  // It is a SECOND CALL to the same endpoint, never a compare_* parameter, so
  // it cannot drift from the primary figure: it IS the primary figure asked
  // for a different period.
  const compare = useMemo(() => previousPeriod(since, until), [since, until]);
  const { data: prev } = usePractitionerPerformance({
    since: compare.since, until: compare.until, practiceId, basis,
  });

  const { data, isLoading, error, isFetching } = usePractitionerPerformance({ since, until, practiceId, basis });
  const { data: practicesData } = usePractices();
  const practiceName = useMemo(
    () => new Map((practicesData?.practices ?? []).map((p: { id: string; name: string }) => [p.id, p.name])),
    [practicesData],
  );

  const t = data?.totals;
  const selected: PerfPractitioner | null = useMemo(
    () => data?.practitioners.find((p) => p.practitionerId === selectedId) ?? null,
    [data, selectedId],
  );

  const activeMeasure = MEASURES.find((m) => m.key === measure)!;

  // Builds the card's comparison. `previous` stays NULL while comparison is
  // off, and HeadlineCard renders no badge at all rather than a confident 0%.
  const cmp = (
    current: number | null,
    previous: number | null,
    polarity: 'higher-better' | 'lower-better' | 'neutral',
    format: (n: number | null) => string,
  ) => ({ current, previous, polarity, format: (n: number) => `${format(n)} · ${compareLabel}` });

  const topGroup = data?.topTreatments?.[0] ?? null;

  // "1–8 Aug 2026". The month is printed once when both ends share it.
  const compareLabel = useMemo(() => {
    const a = new Date(`${compare.since}T12:00:00`);
    const b = new Date(`${compare.until}T12:00:00`);
    const mon = (d: Date) => d.toLocaleString('en-GB', { month: 'short' });
    const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    return sameMonth
      ? `${a.getDate()}\u2013${b.getDate()} ${mon(b)} ${b.getFullYear()}`
      : `${a.getDate()} ${mon(a)} \u2013 ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  }, [compare]);

  // The same person in the comparison window. Matched by ID, never by name:
  // two clinicians can share a surname and a rename must not silently compare
  // one person against another.
  const prevSelected = useMemo(
    () => (selectedId ? prev?.practitioners.find((p) => p.practitionerId === selectedId) ?? null : null),
    [prev, selectedId],
  );

  // Alphabetical, NOT ranked: a picker ordered by revenue silently tells the
  // reader who the best clinician is before they have chosen a measure.
  const practitionerOptions = useMemo(
    () => (data?.practitioners ?? [])
      .map((p) => ({
        id: p.practitionerId,
        label: p.practiceId
          ? `${p.practitionerName} · ${practiceName.get(p.practiceId) ?? 'Unknown site'}`
          : p.practitionerName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [data, practiceName],
  );

  // A practitioner picked in one window can be absent from the next. Falling
  // back to the group beats rendering an empty person page under their name.
  const missingSelection = selectedId !== null && !data?.practitioners.some((p) => p.practitionerId === selectedId);

  // Bars, ordered by the chosen measure. Nulls are dropped rather than drawn at
  // zero — an unknowable figure is not a low one.
  const bars = useMemo(() => {
    const list = (data?.practitioners ?? [])
      .map((p) => ({
        id: p.practitionerId,
        name: p.practitionerName,
        value: p[measure] as number | null,
        util: p.utilisationPct,
      }))
      .filter((b) => b.value !== null) as { id: string; name: string; value: number; util: number | null }[];
    return list.sort((a, b) => b.value - a.value);
  }, [data, measure]);

  const barAverage = useMemo(
    () => (bars.length ? bars.reduce((a, b) => a + b.value, 0) / bars.length : null),
    [bars],
  );

  // The trend line: the group's, or one clinician's when selected. Days with no
  // measurable window carry null so the line BREAKS rather than dipping to zero.
  const trend = useMemo(() => {
    const src = selected ? selected.days : (data?.days ?? []);
    return src.map((d) => ({
      day: d.day,
      label: shortDay(d.day),
      utilisationPct: d.utilisationPct,
      utilisedHours: d.utilisedHours,
      availableHours: d.availableHours,
      revenue: d.revenuePence === null ? null : d.revenuePence / 100,
    }));
  }, [data, selected]);

  const groupCards: HeadlineKpi[] = t ? [
    {
      label: 'Clinicians',
      value: num(t.practitioners),
      sub: `${num(t.daysWorked)} days worked`,
      chip: null,
      compare: cmp(t.practitioners, prev?.totals.practitioners ?? null, 'higher-better', num),
    },
    {
      label: 'Utilisation',
      value: pct(t.utilisationPct),
      sub: `${hrs(t.utilisedHours)} of ${hrs(t.availableHours)}`,
      chip: null,
      // isRate: a change in a percentage is measured in POINTS, not as a
      // percentage of a percentage.
      compare: { ...cmp(t.utilisationPct, prev?.totals.utilisationPct ?? null, 'higher-better', pct), isRate: true },
    },
    {
      label: 'Unused',
      value: hrs(t.unusedHours),
      sub: t.revenuePerUtilisedHourPence !== null
        ? `~${money(Math.round(t.revenuePerUtilisedHourPence * t.unusedHours))}`
        : DASH,
      chip: null,
      // Empty chairs are bad news, so a RISE here is red.
      compare: cmp(t.unusedHours, prev?.totals.unusedHours ?? null, 'lower-better', hrs),
    },
    {
      label: 'Appointments',
      value: num(t.patientAppts),
      sub: num(t.treatments) === DASH ? DASH : `${num(t.treatments)} treatments`,
      chip: null,
      compare: cmp(t.patientAppts, prev?.totals.patientAppts ?? null, 'higher-better', num),
    },
    {
      label: 'Top treatment',
      value: topGroup ? topGroup.treatmentName : DASH,
      sub: topGroup ? `${num(topGroup.treatments)} completed` : DASH,
      // A dash with no explanation reads as a rendering fault. Two words, not
      // a paragraph, and only when the feed is genuinely absent.
      chip: data && !data.treatmentsAvailable ? { text: 'No feed', tone: 'slate' as const } : null,
      // No delta: the previous period's top is often a DIFFERENT treatment, and
      // an arrow between two different things is meaningless. The count moves
      // instead, on the Appointments card beside it.
    },
    {
      label: 'Fees invoiced',
      value: money(t.revenuePence),
      sub: money(t.treatmentValuePence),
      chip: null,
      compare: cmp(t.revenuePence, prev?.totals.revenuePence ?? null, 'higher-better', money),
    },
    {
      label: 'Per used hour',
      value: money(t.revenuePerUtilisedHourPence),
      sub: money(t.revenuePerAvailableHourPence),
      chip: null,
      compare: cmp(t.revenuePerUtilisedHourPence, prev?.totals.revenuePerUtilisedHourPence ?? null, 'higher-better', money),
    },
  ] : [];

  const personCards: HeadlineKpi[] = selected ? [
    {
      label: 'Utilisation',
      value: pct(selected.utilisationPct),
      sub: `${hrs(selected.utilisedHours)} of ${hrs(selected.availableHours)}`,
      chip: t?.utilisationPct != null && selected.utilisationPct != null
        ? {
          text: selected.utilisationPct >= t.utilisationPct ? 'Above group' : 'Below group',
          tone: selected.utilisationPct >= t.utilisationPct ? ('emerald' as const) : ('amber' as const),
        }
        : null,
      compare: { ...cmp(selected.utilisationPct, prevSelected?.utilisationPct ?? null, 'higher-better', pct), isRate: true },
    },
    {
      label: 'Days worked',
      value: num(selected.daysWorked),
      sub: `${num(selected.daysRostered)} rostered`,
      chip: null,
      compare: cmp(selected.daysWorked, prevSelected?.daysWorked ?? null, 'neutral', num),
    },
    {
      label: 'Appointments',
      value: num(selected.patientAppts),
      sub: `${dec(selected.apptsPerWorkedDay)} a day`,
      chip: null,
      compare: cmp(selected.patientAppts, prevSelected?.patientAppts ?? null, 'higher-better', num),
    },
    {
      label: 'Top treatment',
      value: selected.topTreatment ?? DASH,
      sub: selected.topTreatmentCount !== null ? `${num(selected.topTreatmentCount)} completed` : DASH,
      chip: data && !data.treatmentsAvailable ? { text: 'No feed', tone: 'slate' as const } : null,
    },
    {
      label: 'Treatments',
      value: num(selected.treatments),
      sub: money(selected.treatmentValuePence),
      chip: data && !data.treatmentsAvailable ? { text: 'No feed', tone: 'slate' as const } : null,
      compare: cmp(selected.treatments, prevSelected?.treatments ?? null, 'higher-better', num),
    },
    {
      label: 'Fees invoiced',
      value: money(selected.revenuePence),
      sub: `${money(selected.revenuePerDayPence)} a day`,
      chip: null,
      compare: cmp(selected.revenuePence, prevSelected?.revenuePence ?? null, 'higher-better', money),
    },
    {
      label: 'Per used hour',
      value: money(selected.revenuePerUtilisedHourPence),
      sub: money(selected.revenuePerAvailableHourPence),
      chip: null,
      compare: cmp(selected.revenuePerUtilisedHourPence, prevSelected?.revenuePerUtilisedHourPence ?? null, 'higher-better', money),
    },
  ] : [];

  const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 } as const;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Practitioner performance"
        subtitle="Time, treatment and money for each clinician"
      />

      {/* Dentally-only: every figure here comes from the synced diary and
          invoicing, so offering a practice with no Dentally site would render a
          confident empty page rather than saying it is not connected. */}
      <ScopePeriodBar dentallyOnly />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="perf-basis">Available time</label>
          <select
            id="perf-basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value as UtilBasis)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
          >
            <option value="rota">Rostered hours — Dentally&rsquo;s own rota</option>
            <option value="clinical">Clinical window — first to last patient</option>
            <option value="span">Diary span — first to last of anything</option>
          </select>
        </div>
        {/* The practitioner filter. A SELECT rather than a search box: the
            roster is a few dozen people, all of them already loaded, so a list
            you can scan beats one you have to guess the spelling of. Clicking a
            bar sets the same state, so the two controls cannot disagree. */}
        <div className="flex items-center gap-2">
          <label className="text-ink-muted shrink-0 text-xs font-semibold" htmlFor="perf-practitioner">
            Practitioner
          </label>
          <select
            id="perf-practitioner"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="max-w-[220px] rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
          >
            <option value="">All practitioners</option>
            {practitionerOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        {selected && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:border-brand-200"
          >
            ← Back to the group
          </button>
        )}
        <span className="text-ink-muted ml-auto text-[11px] tabular-nums">
          {since} → {until}{isFetching ? ' · updating…' : ''}
        </span>
      </div>

      {error && (
        // A named failure, never a silent empty state — a malformed path 404s
        // into something indistinguishable from "no data".
        <div className="card" style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Could not load performance: {(error as Error).message}
        </div>
      )}

      {!isLoading && missingSelection && (
        <div className="text-ink-muted rounded-panel border border-border bg-card px-3 py-2 text-[12px]">
          That practitioner treated nobody in this window, so the group is shown instead.
        </div>
      )}

      {isLoading ? (
        <div style={cardGrid}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !data || data.practitioners.length === 0 ? (
        <Card>
          <EmptyState message="No practitioner treated a patient in this window." />
        </Card>
      ) : (
        <>
          {/* ---------- ONE CLINICIAN ---------- */}
          {selected ? (
            <>
              <SectionLabel>
                {`${selected.practitionerName}${selected.practiceId ? ` · ${practiceName.get(selected.practiceId) ?? 'Unknown site'}` : ''}`}
              </SectionLabel>
              <div style={cardGrid}>
                {personCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
              </div>
            </>
          ) : (
            <>
              <SectionLabel>The group</SectionLabel>
              <div style={cardGrid}>
                {groupCards.map((c) => <HeadlineCard key={c.label} c={c} />)}
              </div>
            </>
          )}

          {/* ---------- TREND ---------- */}
          <Card>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">
                  {selected ? `${selected.practitionerName} — day by day` : 'The group — day by day'}
                </div>
              </div>
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="h" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, 120]} unit="%" tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v, name) => {
                      // recharts types a tooltip value as string | number |
                      // array, so the null guard has to survive that widening -
                      // an unguarded value renders "0h" for a day we know
                      // nothing about.
                      const n = typeof v === 'number' ? v : null;
                      const label = String(name);
                      if (n === null) return [DASH, label];
                      if (label === 'Utilisation') return [`${n.toFixed(1)}%`, label];
                      return [`${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })}h`, label];
                    }}
                    contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }}
                  />
                  <Area yAxisId="h" dataKey="availableHours" name="Rostered" type="monotone"
                    stroke="#C7D2FE" fill="#E0E7FF" strokeWidth={1} />
                  <Bar yAxisId="h" dataKey="utilisedHours" name="Used" fill="#4F46E5" radius={[2, 2, 0, 0]} maxBarSize={18} />
                  {/* connectNulls is deliberately OFF: a gap is information. */}
                  <Line yAxisId="p" dataKey="utilisationPct" name="Utilisation" type="monotone"
                    stroke="#0F766E" strokeWidth={2} dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ---------- COMPARISON ---------- */}
          {!selected && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Every clinician, compared</div>
                </div>
                <select
                  value={measure}
                  onChange={(e) => setMeasure(e.target.value as Measure)}
                  aria-label="Measure to compare"
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] transition-colors hover:border-brand-200"
                >
                  {MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              {bars.length === 0 ? (
                <EmptyState message="No clinician has a figure for that measure in this window." />
              ) : (
                // Height grows with the roster: 40 clinicians in a fixed 300px
                // box is an unreadable smear of bars.
                <div style={{ height: Math.max(220, bars.length * 26 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => (activeMeasure.money ? money(v * 100) : activeMeasure.format(v))}
                      />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: '#F9FAFB' }}
                        formatter={(v) => {
                          const n = typeof v === 'number' ? v : null;
                          return [activeMeasure.money ? money(n) : activeMeasure.format(n), activeMeasure.label];
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB' }}
                      />
                      {barAverage !== null && (
                        <ReferenceLine x={barAverage} stroke="#6B7280" strokeDasharray="4 4" />
                      )}
                      <Bar
                        dataKey="value"
                        radius={[0, 3, 3, 0]}
                        maxBarSize={18}
                        onClick={(d: { id?: string }) => d?.id && setSelectedId(d.id)}
                        cursor="pointer"
                      >
                        {/* Coloured by UTILISATION, not by the measure itself:
                            the interesting clinician is the one earning well on
                            a half-empty diary, and a bar shaded by its own
                            length would only repeat what its length says. */}
                        {bars.map((b) => <Cell key={b.id} fill={utilTone(b.util)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="text-ink-muted mt-2 flex flex-wrap items-center gap-3 text-[10px]">
                <span>Bar colour is utilisation:</span>
                {[[100, '> 100%'], [80, '81–100%'], [60, '61–80%'], [40, '41–60%'], [20, '21–40%'], [0, '0–20%']]
                  .map(([v, label]) => (
                    <span key={String(label)} className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: utilTone(Number(v) + 1) }} />
                      {label}
                    </span>
                  ))}
              </div>
            </Card>
          )}

        </>
      )}
    </div>
  );
}
