'use client';
// Categorise each GoHighLevel pipeline. Lives in the GoHighLevel card on the
// Integrations page and nowhere else.
//
// Pipelines are nested under the subaccount that owns them, collapsed by
// default: that IS the hierarchy GoHighLevel has, and a pipeline id means
// nothing outside its Location. There is deliberately no practice mapping
// here.
//
// SCALE: this org has ~113 pipelines across 7 subaccounts and about half have
// no leads at all, so the list is grouped by subaccount, sorted by lead volume
// and filterable. A flat board would bury the pipelines that matter.
//
// NO INFERENCE: a pipeline with no channel is Unassigned and stays that way
// until somebody sets it. The old name-matching heuristic classified the three
// largest pipelines ("Open Day Archive - IMPLANTS" and friends, 1122/990/873
// leads) as 'other' while catching only the 33-lead pipeline that happened to
// have "Google" in its name.
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { useSetPipelineChannel } from '../hooks';
import { useSetOpenDayPipeline, useCreateOpenDay } from '@/features/marketing/facebook/hooks';
import type { AdAttributionConfig, AdChannel, PipelineRow } from '../api';

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  open_day: 'Open day',
  unassigned: 'Unassigned',
};

// Open day sits in the SAME segmented control as Google and Facebook rather
// than in a separate dropdown, because the previous shape was a dead end: the
// open-day picker only rendered once the pipeline was already Facebook AND at
// least one event existed, so an org with no events saw no way to mark one and
// every row read "Always-on" with nothing to change it to.
//
// The four states are mutually exclusive as DISPLAYED, and open day wins the
// display when both are set — matching the reporting rule that a pipeline
// mapped to an event counts as that event's, never as always-on.
type PipelineMark = AdChannel | 'open_day' | null;

// The generic name a first event gets when somebody marks a pipeline or
// campaign as an open day before naming any event. Deliberately not derived
// from the pipeline's own name: a name read off the data is a guess, and this
// one is a placeholder the owner renames, not an answer.
const FIRST_EVENT_NAME = 'Open day';

// Pipeline ids are only unique within a GoHighLevel Location, so every key,
// map lookup and comparison must be the composite accountId|pipelineId —
// never the bare pipelineId.
function pipelineKey(accountId: string, pipelineId: string) {
  return `${accountId}|${pipelineId}`;
}

function ChannelButtons({ row, isOpenDay, onSet, busy }: {
  row: PipelineRow;
  isOpenDay: boolean;
  onSet: (mark: PipelineMark) => void;
  busy: boolean;
}) {
  const options: Array<{ value: PipelineMark; label: string }> = [
    { value: 'google_ads', label: 'Google' },
    { value: 'meta_ads', label: 'Facebook' },
    { value: 'open_day', label: 'Open day' },
    { value: null, label: 'Unassigned' },
  ];
  // An open-day mapping outranks the channel here exactly as it does in the
  // report, so a pipeline carrying both never renders as two active buttons.
  const current: PipelineMark = isOpenDay ? 'open_day' : (row.channel ?? null);
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300">
      {options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.label}
            type="button"
            disabled={busy}
            onClick={() => onSet(o.value)}
            className={`px-2 py-1 text-[12px] ${
              active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

export default function PipelineChannelStep({ config, openDays, openDayAssignedTo }: {
  config: AdAttributionConfig;
  openDays?: { id: string; name: string }[];
  /** `${accountId}|${pipelineId}` -> open day id. */
  openDayAssignedTo?: Record<string, string>;
}) {
  const setChannel = useSetPipelineChannel();
  const setPipeline = useSetOpenDayPipeline();
  const createOpenDay = useCreateOpenDay();
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  // Subaccounts collapse by default: 113 pipelines across 7 Locations is a
  // wall of rows, and the question being answered is "what is in THIS
  // subaccount". A search expands everything, because a hit inside a closed
  // section would otherwise be invisible and read as "no results".
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAccount = new Map<string, { accountId: string; label: string; practiceName: string | null; rows: PipelineRow[] }>();
    for (const p of config.pipelines) {
      // A pipeline that already carries a channel must never disappear just
      // because it currently has no leads — otherwise an operator who fixes
      // a quiet pipeline can no longer find it to correct a mistake.
      if (hideEmpty && p.leadCount === 0 && p.channel === null) continue;
      if (q && !p.pipelineName.toLowerCase().includes(q)) continue;
      if (!byAccount.has(p.accountId)) {
        byAccount.set(p.accountId, { accountId: p.accountId, label: p.accountLabel, practiceName: p.practiceName, rows: [] });
      }
      byAccount.get(p.accountId)!.rows.push(p);
    }
    for (const g of byAccount.values()) g.rows.sort((a, b) => b.leadCount - a.leadCount);
    return [...byAccount.values()].sort(
      (a, b) => b.rows.reduce((n, r) => n + r.leadCount, 0) - a.rows.reduce((n, r) => n + r.leadCount, 0),
    );
  }, [config.pipelines, search, hideEmpty]);

  // Counted the same way the buttons render — open day first, so the tallies
  // and the highlighted buttons can never disagree about a pipeline.
  const counts = useMemo(() => {
    const c = { google_ads: 0, meta_ads: 0, open_day: 0, unassigned: 0 };
    for (const p of config.pipelines) {
      if (openDayAssignedTo?.[pipelineKey(p.accountId, p.pipelineId)]) c.open_day += 1;
      else c[p.channel ?? 'unassigned'] += 1;
    }
    return c;
  }, [config.pipelines, openDayAssignedTo]);

  // A section is open when the operator opened it, or whenever a search is
  // active — a match hidden inside a collapsed section reads as no match.
  const searching = search.trim().length > 0;
  const isOpen = (accountId: string) => searching || Boolean(opened[accountId]);

  // Marking a pipeline as an open day must work from a cold start, so when the
  // org has no events yet the first mark creates one. Without this the button
  // would have nothing to write to (open_day_id is NOT NULL and a foreign key)
  // and would silently do nothing — the dead end this control replaces.
  async function ensureOpenDayId(): Promise<string> {
    const existing = openDays?.[0]?.id;
    if (existing) return existing;
    const made = await createOpenDay.mutateAsync({ name: FIRST_EVENT_NAME, eventDate: null });
    return (made as { id: string }).id;
  }

  async function handle(row: PipelineRow, mark: PipelineMark) {
    const key = pipelineKey(row.accountId, row.pipelineId);
    setBusy(key);
    setError(null);
    try {
      if (mark === 'open_day') {
        await setPipeline.mutateAsync({
          integrationAccountId: row.accountId,
          ghlPipelineId: row.pipelineId,
          openDayId: await ensureOpenDayId(),
        });
      } else {
        // Clear any open-day mapping BEFORE writing the channel. A pipeline
        // left mapped to an event while also carrying a channel is counted
        // under both, and the always-on + open days = total identity breaks.
        if (openDayAssignedTo?.[key]) {
          await setPipeline.mutateAsync({
            integrationAccountId: row.accountId,
            ghlPipelineId: row.pipelineId,
            openDayId: null,
          });
        }
        await setChannel.mutateAsync({ accountId: row.accountId, pipelineId: row.pipelineId, channel: mark });
      }
    } catch (e) {
      setError(`${row.pipelineName}: ${(e as Error).message || 'Could not save that change. Please try again.'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-[15px] font-semibold text-slate-900">
        Step 2 — Sort pipelines into channels
      </h2>
      <p className="mb-3 text-[13px] text-slate-600">
        Open a subaccount to see its pipelines. Leads are counted as Google, Facebook
        or an open day based only on the pipeline they arrive in — anything you leave
        unassigned is reported separately, never guessed at.
      </p>

      {error && (
        <p className="mb-3 text-[13px] text-danger">{error}</p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {(['google_ads', 'meta_ads', 'open_day', 'unassigned'] as const).map((c) => (
          <span key={c} className="text-[12px] text-slate-600">
            {CHANNEL_LABEL[c]}: <strong className="text-slate-900">{counts[c]}</strong>
          </span>
        ))}
        <input
          className="ml-auto rounded border border-slate-300 px-2 py-1 text-[13px]"
          placeholder="Search pipelines"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1 text-[12px] text-slate-600">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide pipelines with no leads
        </label>
      </div>

      {groups.map((g) => (
        <div key={g.accountId} className="mb-2 rounded border border-slate-200">
          <button
            type="button"
            onClick={() => setOpened((o) => ({ ...o, [g.accountId]: !isOpen(g.accountId) }))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          >
            <span className="text-[12px] text-slate-500">{isOpen(g.accountId) ? '▾' : '▸'}</span>
            <h3 className="text-[13px] font-semibold text-slate-900">{g.label}</h3>
            <span className="text-[12px] text-slate-500">
              {g.rows.length} pipeline{g.rows.length === 1 ? '' : 's'}
            </span>
            <span className="ml-auto text-[12px] text-slate-500">
              {g.rows.reduce((n, r) => n + r.leadCount, 0).toLocaleString('en-GB')} leads
            </span>
          </button>
          <div className={`overflow-x-auto px-3 pb-2 ${isOpen(g.accountId) ? '' : 'hidden'}`}>
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <tbody>
                {g.rows.map((p) => (
                  <tr key={pipelineKey(p.accountId, p.pipelineId)} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-800">{p.pipelineName}</td>
                    <td className="py-2 pr-3 text-right text-slate-500">
                      {p.leadCount.toLocaleString('en-GB')} leads
                    </td>
                    <td className="py-2 text-right">
                      <ChannelButtons
                        row={p}
                        isOpenDay={Boolean(openDayAssignedTo?.[pipelineKey(p.accountId, p.pipelineId)])}
                        busy={busy === pipelineKey(p.accountId, p.pipelineId)}
                        onSet={(c) => handle(p, c)}
                      />
                    </td>
                    {/* WHICH event, shown only once the row IS an open day.
                        Never a gate on the marking itself — that was the bug:
                        the picker used to be the only way in, and it rendered
                        for nobody until an event already existed. */}
                    <td className="py-2 pl-3 text-right">
                      {openDayAssignedTo?.[pipelineKey(p.accountId, p.pipelineId)] ? (
                        <select
                          className="rounded-panel border border-border bg-white px-2 py-1 text-[12.5px] text-ink"
                          value={openDayAssignedTo[pipelineKey(p.accountId, p.pipelineId)]}
                          onChange={(e) => setPipeline.mutate({
                            integrationAccountId: p.accountId,
                            ghlPipelineId: p.pipelineId,
                            openDayId: e.target.value || null,
                          })}
                        >
                          {(openDays ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {groups.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">No pipelines match that filter.</p>
      ) : null}
    </Card>
  );
}
