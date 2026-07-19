'use client';
// Step 2 of ad attribution: put each pipeline in a channel.
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
import type { AdAttributionConfig, AdChannel, PipelineRow } from '../api';

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

// Pipeline ids are only unique within a GoHighLevel Location, so every key,
// map lookup and comparison must be the composite accountId|pipelineId —
// never the bare pipelineId.
function pipelineKey(accountId: string, pipelineId: string) {
  return `${accountId}|${pipelineId}`;
}

function ChannelButtons({ row, onSet, busy }: {
  row: PipelineRow;
  onSet: (channel: AdChannel | null) => void;
  busy: boolean;
}) {
  const options: Array<{ value: AdChannel | null; label: string }> = [
    { value: 'google_ads', label: 'Google' },
    { value: 'meta_ads', label: 'Facebook' },
    { value: null, label: 'Unassigned' },
  ];
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300">
      {options.map((o) => {
        const active = (row.channel ?? null) === o.value;
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

export default function PipelineChannelStep({ config }: { config: AdAttributionConfig }) {
  const setChannel = useSetPipelineChannel();
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
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

  const counts = useMemo(() => {
    const c = { google_ads: 0, meta_ads: 0, unassigned: 0 };
    for (const p of config.pipelines) c[p.channel ?? 'unassigned'] += 1;
    return c;
  }, [config.pipelines]);

  async function handle(row: PipelineRow, channel: AdChannel | null) {
    const key = pipelineKey(row.accountId, row.pipelineId);
    setBusy(key);
    setError(null);
    try {
      await setChannel.mutateAsync({ accountId: row.accountId, pipelineId: row.pipelineId, channel });
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
        Leads are counted as Google or Facebook based only on the pipeline they arrive in.
        Anything you leave unassigned is reported separately, never guessed at.
      </p>

      {error && (
        <p className="mb-3 text-[13px] text-danger">{error}</p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {(['google_ads', 'meta_ads', 'unassigned'] as const).map((c) => (
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
        <div key={g.accountId} className="mb-4">
          <div className="mb-1 flex items-baseline gap-2">
            <h3 className="text-[13px] font-semibold text-slate-900">{g.label}</h3>
            <span className="text-[12px] text-slate-500">
              {g.practiceName ?? 'Not connected to a practice — excluded from ad performance'}
            </span>
          </div>
          <div className="overflow-x-auto">
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
                        busy={busy === pipelineKey(p.accountId, p.pipelineId)}
                        onSet={(c) => handle(p, c)}
                      />
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
