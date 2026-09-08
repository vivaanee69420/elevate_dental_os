'use client';
// Practitioner schedules — entering the rota Dentally will not give us.
//
// WHY THIS PAGE EXISTS. Utilisation needs available time, and available time
// is the practitioner's working schedule. Dentally holds one and its v1 API
// does not publish it: 29 paths probed, including every nested and plural
// form, all 404. Its newer NexGen API exists but needs credentials we do not
// have. Dentally's own support confirmed the schedule lives in the calendar
// and is not exposed.
//
// WHY IT IS NOT INFERRED. Because the diary does not hold still. Across 73
// practitioner-weekday slots with three or more days of history, only 7 had a
// start time consistent within half an hour and only ONE a consistent end
// time; average scatter is 96 minutes on starts and 131 on ends. A median
// would look authoritative and be an hour and a half out, so what the diary
// showed is displayed BESIDE each row as a check — never written into it.
//
// The job is smaller than it looks: 49 practitioners see patients here across
// 135 practitioner-weekday slots, because most work two or three days.

import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { useScheduleOverview, useSaveScheduleWeek } from '../practitioner-schedule-hooks';
import type { ScheduleDay, SchedulePractitioner } from '../practitioner-schedule-api';
import { usePractices } from '@/features/integrations/hooks';
import { DASH } from '@/features/marketing/_shared/format';

const DAYS = [
  { iso: 1, label: 'Mon' }, { iso: 2, label: 'Tue' }, { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' }, { iso: 5, label: 'Fri' }, { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

/** 540 -> "09:00". Minutes from local midnight, throughout. */
function toHHMM(min: number | null | undefined): string {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** "09:00" -> 540, or null for an empty or unparseable value. */
function fromHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}
const hoursLabel = (min: number) => `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)}h`;

type DraftDay = { startMin: number | null; endMin: number | null; breakMin: number };
type Draft = Record<number, DraftDay>;   // ISO weekday -> values

const EMPTY_DAY: DraftDay = { startMin: null, endMin: null, breakMin: 0 };

function draftFrom(p: SchedulePractitioner): Draft {
  const d: Draft = {};
  for (const day of DAYS) d[day.iso] = { ...EMPTY_DAY };
  for (const w of p.week) {
    d[w.weekday] = { startMin: w.startMin, endMin: w.endMin, breakMin: w.breakMin };
  }
  return d;
}

/** The rows a draft would save: only days with BOTH ends filled in. */
function daysFromDraft(draft: Draft): ScheduleDay[] {
  return DAYS
    .filter((d) => draft[d.iso].startMin !== null && draft[d.iso].endMin !== null)
    .map((d) => ({
      weekday: d.iso,
      startMin: draft[d.iso].startMin as number,
      endMin: draft[d.iso].endMin as number,
      breakMin: draft[d.iso].breakMin || 0,
    }));
}

/** What is wrong with a draft, in the words someone entering it would use. */
function problemsIn(draft: Draft): string[] {
  const out: string[] = [];
  for (const d of DAYS) {
    const v = draft[d.iso];
    const half = (v.startMin === null) !== (v.endMin === null);
    if (half) out.push(`${d.label}: needs both a start and a finish`);
    if (v.startMin !== null && v.endMin !== null) {
      if (v.endMin <= v.startMin) out.push(`${d.label}: finishes before it starts`);
      else if (v.breakMin >= v.endMin - v.startMin) out.push(`${d.label}: break is longer than the day`);
    }
  }
  return out;
}

function PractitionerRow({
  p, practiceName, onSaved,
}: {
  p: SchedulePractitioner;
  practiceName: Map<string, string>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(p));
  const save = useSaveScheduleWeek();

  // Re-seed when the server's copy changes, so a refetch does not leave the
  // form showing something that is no longer stored.
  useEffect(() => { setDraft(draftFrom(p)); }, [p]);

  const observed = useMemo(
    () => new Map(p.observed.map((o) => [o.weekday, o])),
    [p.observed],
  );

  const rows = daysFromDraft(draft);
  const problems = problemsIn(draft);
  const weekMin = rows.reduce((a, r) => a + Math.max(0, r.endMin - r.startMin - r.breakMin), 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(p));

  const set = (iso: number, patch: Partial<DraftDay>) =>
    setDraft((d) => ({ ...d, [iso]: { ...d[iso], ...patch } }));

  /** Copy the first filled day across every weekday that has a diary history.
   *  Most schedules are the same pattern repeated, and typing it five times is
   *  five chances to fat-finger it. */
  const copyAcross = () => {
    const first = DAYS.find((d) => draft[d.iso].startMin !== null && draft[d.iso].endMin !== null);
    if (!first) return;
    const src = draft[first.iso];
    setDraft((d) => {
      const next = { ...d };
      for (const day of DAYS) {
        // Only onto days they are actually known to work — copying Monday onto
        // a Sunday nobody works would invent availability.
        if (observed.has(day.iso)) next[day.iso] = { ...src };
      }
      return next;
    });
  };

  return (
    <div className="border-b border-border px-3 py-3 last:border-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <strong className="text-[13px]">{p.practitionerName}</strong>
          {p.practiceId && (
            <span className="text-ink-muted ml-2 text-[11px]">
              {practiceName.get(p.practiceId) ?? 'Unknown site'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-muted text-[11px] tabular-nums">
            {rows.length === 0 ? 'No schedule set' : `${hoursLabel(weekMin)} a week over ${rows.length} ${rows.length === 1 ? 'day' : 'days'}`}
          </span>
          <button
            type="button"
            onClick={copyAcross}
            className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-medium transition-colors hover:border-brand-200"
            title="Copy the first filled day onto every day they are known to work"
          >
            Copy across
          </button>
          <button
            type="button"
            disabled={!dirty || problems.length > 0 || save.isPending}
            onClick={() => save.mutate(
              { practitionerId: p.practitionerId, days: rows },
              { onSuccess: onSaved },
            )}
            className="rounded-lg bg-brand px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save week' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="crm-board-scroll overflow-x-auto">
        <table className="text-[12px]">
          <thead>
            <tr>
              <th className="text-ink-muted w-[70px] py-1 pr-2 text-left text-[10px] font-semibold" />
              {DAYS.map((d) => (
                <th key={d.iso} className="text-ink-muted px-1 py-1 text-center text-[10px] font-semibold" style={{ minWidth: 92 }}>
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['startMin', 'endMin'] as const).map((field) => (
              <tr key={field}>
                <td className="text-ink-muted py-0.5 pr-2 text-[10px] font-semibold">
                  {field === 'startMin' ? 'Start' : 'Finish'}
                </td>
                {DAYS.map((d) => (
                  <td key={d.iso} className="px-1 py-0.5">
                    <input
                      type="time"
                      value={toHHMM(draft[d.iso][field])}
                      onChange={(e) => set(d.iso, { [field]: fromHHMM(e.target.value) } as Partial<DraftDay>)}
                      aria-label={`${p.practitionerName} ${d.label} ${field === 'startMin' ? 'start' : 'finish'}`}
                      className="w-full rounded-lg border border-border bg-card px-1.5 py-1 text-[12px] tabular-nums"
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="text-ink-muted py-0.5 pr-2 text-[10px] font-semibold">Break</td>
              {DAYS.map((d) => (
                <td key={d.iso} className="px-1 py-0.5">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={draft[d.iso].breakMin || ''}
                    placeholder="0"
                    onChange={(e) => set(d.iso, { breakMin: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`${p.practitionerName} ${d.label} break minutes`}
                    className="w-full rounded-lg border border-border bg-card px-1.5 py-1 text-[12px] tabular-nums"
                  />
                </td>
              ))}
            </tr>
            <tr>
              {/* THE OBSERVED DIARY, as a check — not a suggestion. It is what
                  their appointments actually spanned, with how many days that
                  is drawn from, because a hint from two days is worth less
                  than one from twenty. */}
              <td className="text-ink-muted py-0.5 pr-2 text-[10px]">Diary</td>
              {DAYS.map((d) => {
                const o = observed.get(d.iso);
                return (
                  <td key={d.iso} className="text-ink-muted px-1 py-0.5 text-center text-[10px] tabular-nums">
                    {o && o.medianClinicalMin !== null
                      ? <span title={`Median patient window across ${o.days} ${o.days === 1 ? 'day' : 'days'}`}>
                          ~{hoursLabel(o.medianClinicalMin)} <span className="opacity-60">({o.days}d)</span>
                        </span>
                      : DASH}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {problems.length > 0 && (
        <ul className="text-danger mt-1.5 space-y-0.5 text-[11px]">
          {problems.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {save.isError && (
        <p className="text-danger mt-1.5 text-[11px]">
          Could not save: {(save.error as Error).message}
        </p>
      )}
    </div>
  );
}

export default function PractitionerSchedulesScreen() {
  const { data, isLoading, error, refetch } = useScheduleOverview();
  const { data: practicesData } = usePractices();
  const practiceName = useMemo(
    () => new Map((practicesData?.practices ?? []).map((p: { id: string; name: string }) => [p.id, p.name])),
    [practicesData],
  );

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    let list = data?.practitioners ?? [];
    if (onlyMissing) list = list.filter((p) => p.week.length === 0);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.practitionerName.toLowerCase().includes(q));
    return list;
  }, [data, onlyMissing, search]);

  const progress = data?.progress;

  return (
    <div className="mx-auto w-full space-y-4" style={{ maxWidth: 1400 }}>
      <PageHeader
        title="Practitioner schedules"
        subtitle={isLoading || !progress
          ? 'Loading…'
          : `${progress.withSchedule} of ${progress.practitioners} practitioners have a schedule`}
      />

      <div className="text-ink-muted rounded-panel border border-border bg-card px-3 py-2.5 text-[12px]">
        Utilisation divides patient time by available time, and available time is the
        practitioner&rsquo;s working schedule. <strong>Dentally holds that schedule but its API does
        not publish it</strong>, so it is entered here. The <strong>Diary</strong> row shows what their
        appointments actually spanned — a check, not a suggestion: measured across this
        practice, start times vary by about an hour and a half either way, so it is not
        reliable enough to fill the form in for you.
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border bg-card px-3 py-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a practitioner"
          aria-label="Find a practitioner"
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px]"
        />
        <label className="text-ink-muted flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Only those without a schedule
        </label>
        {progress && progress.withSchedule < progress.practitioners && (
          <span className="text-ink-muted ml-auto text-[11px]">
            {progress.practitioners - progress.withSchedule} still to do
          </span>
        )}
      </div>

      {error && (
        <div className="card" style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Could not load schedules: {(error as Error).message}
        </div>
      )}

      <Card padded={false}>
        {isLoading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState message={
            (data?.practitioners.length ?? 0) === 0
              ? 'No practitioners have seen patients in the last 90 days, so there is nothing to schedule yet.'
              : onlyMissing
                ? 'Every practitioner has a schedule.'
                : 'No practitioner matches that search.'
          } />
        ) : (
          shown.map((p) => (
            <PractitionerRow
              key={p.practitionerId}
              p={p}
              practiceName={practiceName}
              onSaved={() => refetch()}
            />
          ))
        )}
      </Card>
    </div>
  );
}
