'use client';
// LeadComparison — Google vs Facebook leads/conversions, matched to
// Emergent-accepted treatments by phone/email/name.
//
// Two rules this section exists to keep honest, both learned the hard way:
//
//  1. Scope coherence. The headline cards follow the selected practice; the
//     group figure is shown BESIDE it as context, never in place of it. (The
//     old version showed a practice-scoped table of 0 next to an org-wide
//     "62 leads" card, which read as a fabricated number.)
//  2. Leads are PEOPLE. One contact sitting in two pipelines of the same
//     channel is one lead, not two — `entries` carries the raw pipeline-row
//     count when the two differ.
//
// Ad spend / CPL / ROI stay group-level: ad_metrics carries no practice, so a
// per-practice spend figure would be a guess.
import { Fragment, useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useCockpitLeads } from '../hooks';
import { PipelineTag } from './PipelineTag';
import { LeadsTable, dedupeByPerson, CHANNEL_ORDER, type LeadRow } from './LeadsTable';
import type { LeadRoi, LeadChannel, LeadRoiGroupStats } from '../api';

function rate(n: number, d: number): string {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

const CHANNELS: Array<{ key: 'google' | 'facebook'; label: string }> = [
  { key: 'google', label: 'Google' },
  { key: 'facebook', label: 'Facebook' },
];

// The leads list — fetched only once "View leads" is opened. Fetched WITHOUT a
// channel param (up to 500 rows) and grouped/filtered by channel CLIENT-SIDE:
// the backend's channel filter runs after classification, so it can short a page.
function LeadsList({ practiceId, win }: { practiceId?: string; win: { since: string; until: string } }) {
  const { data, isLoading, isError } = useCockpitLeads(true, {
    since: win.since,
    until: win.until,
    practiceId,
    limit: 500,
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading leads…</p>;
  if (isError) return <p className="text-sm text-rose-700">Couldn&rsquo;t load leads.</p>;
  const lines = data?.lines ?? [];
  if (lines.length === 0) return <p className="text-sm text-slate-500">No leads in this window.</p>;

  const byChannel = new Map<LeadChannel, LeadRow[]>();
  for (const l of dedupeByPerson(lines)) {
    if (!byChannel.has(l.channel)) byChannel.set(l.channel, []);
    byChannel.get(l.channel)!.push(l);
  }

  return (
    <div className="space-y-4">
      {CHANNEL_ORDER.filter((ch) => byChannel.has(ch)).map((ch) => {
        const rows = byChannel.get(ch)!;
        const converted = rows.filter((r) => r.converted).length;
        return (
          <div key={ch}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PipelineTag channel={ch} />
              <span className="text-xs text-slate-400">
                {formatNumber(rows.length)} lead{rows.length === 1 ? '' : 's'} · {formatNumber(converted)} accepted a treatment
              </span>
            </div>
            <LeadsTable rows={rows} />
          </div>
        );
      })}
      {lines.length === (data?.limit ?? 0) && (
        <p className="text-xs text-slate-400">Showing the first {data?.limit} leads — narrow the period or practice to see fewer at once.</p>
      )}
    </div>
  );
}

// One channel's headline block. When a practice is selected `stats` is that
// practice's and `groupStats` is shown underneath as context; unscoped, the two
// are the same figure and the context line is dropped.
function ChannelCard({
  label,
  stats,
  groupStats,
  spendPence,
  cplPence,
  roi,
  scopedName,
}: {
  label: string;
  stats: LeadRoiGroupStats;
  groupStats: LeadRoiGroupStats;
  spendPence: number;
  cplPence: number | null;
  roi: number | null;
  scopedName: string | null;
}) {
  const cpl = cplPence == null || spendPence === 0 ? '—' : formatPence(cplPence);
  const roiText = roi == null ? '—' : `${roi.toFixed(1)}×`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          {label} — {scopedName ?? 'all practices'}
        </div>
        <PipelineTag channel={label.toLowerCase() as LeadChannel} />
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(stats.leads)}</span>
        <span className="text-[13px] text-slate-500">leads</span>
      </div>
      {stats.entries > stats.leads ? (
        <div className="text-[11px] text-slate-400">
          {formatNumber(stats.entries)} pipeline entries — {formatNumber(stats.entries - stats.leads)} are the same person in more than one pipeline
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-slate-500">Accepted a treatment</dt>
        <dd className="text-right tabular-nums text-slate-900">
          {formatNumber(stats.conversions)} <span className="text-slate-400">({rate(stats.conversions, stats.leads)})</span>
        </dd>
        <dt className="text-slate-500">Value accepted</dt>
        <dd className="text-right tabular-nums text-slate-900">{formatPence(stats.matchedValuePence)}</dd>
      </dl>

      {scopedName ? (
        <p className="mt-2 border-t border-slate-100 pt-2 text-[12px] text-slate-500">
          Group (all practices): {formatNumber(groupStats.leads)} leads · {formatNumber(groupStats.conversions)} accepted
        </p>
      ) : null}

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[13px]">
        <dt className="text-slate-500">Ad spend (group)</dt>
        <dd className="text-right tabular-nums text-slate-900">{spendPence === 0 ? '—' : formatPence(spendPence)}</dd>
        <dt className="text-slate-500">Cost per lead (group)</dt>
        <dd className="text-right tabular-nums text-slate-900">{cpl}</dd>
        <dt className="text-slate-500">Return on ad spend (group)</dt>
        <dd className="text-right tabular-nums text-slate-900">{roiText}</dd>
      </dl>
    </div>
  );
}

export function LeadComparison({
  data,
  practiceId,
  practiceName,
  win,
}: {
  data: LeadRoi;
  practiceId?: string;
  practiceName?: string | null;
  win: { since: string; until: string };
}) {
  const [showLeads, setShowLeads] = useState(false);

  const scopedName = practiceId ? practiceName ?? 'selected practice' : null;
  const stats = data.scoped ?? data.group;

  const rowsByPractice = new Map<
    string,
    { practiceId: string | null; practiceName: string | null; byChannel: Map<string, LeadRoi['channels'][number]> }
  >();
  for (const c of data.channels) {
    if (c.channel !== 'google' && c.channel !== 'facebook') continue;
    const key = c.practiceId ?? '__unmapped__';
    if (!rowsByPractice.has(key)) {
      rowsByPractice.set(key, { practiceId: c.practiceId, practiceName: c.practiceName, byChannel: new Map() });
    }
    rowsByPractice.get(key)!.byChannel.set(c.channel, c);
  }
  const practiceRows = Array.from(rowsByPractice.values()).sort((a, b) =>
    (a.practiceName ?? '').localeCompare(b.practiceName ?? ''),
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">
            3
          </span>
          Leads — Google vs Facebook
        </h2>
        <span className="text-xs text-slate-400">First touch · matched by phone, email or name</span>
      </div>
      <p className="mb-3 max-w-3xl text-xs text-slate-500">
        Every person who came in through a Google or Facebook ad pipeline in GoHighLevel, and whether they went on to
        accept a treatment in Emergent. A lead is a <strong>person</strong> — someone sitting in two pipelines is counted
        once. Leads usually accept weeks after they arrive, so a recent window will show few conversions even when the
        ads are working.
      </p>

      {data.unmapped.leads > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <strong>{formatNumber(data.unmapped.leads)} leads are not counted</strong> — they belong to GoHighLevel
          subaccounts that aren&rsquo;t linked to a practice ({data.unmapped.accounts.map((a) => a.label).join(', ')}).
          If any of those is a practice, link it under System &gt; Integrations and its leads will start counting here.
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.key}
            label={ch.label}
            stats={stats[ch.key]}
            groupStats={data.group[ch.key]}
            spendPence={data.groupChannels[ch.key].spendPence}
            cplPence={data.groupChannels[ch.key].cplPence}
            roi={data.groupChannels[ch.key].roi}
            scopedName={scopedName}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-slate-500">
          See every individual lead — name, pipeline it came in on, and whether it converted.
        </span>
        <button
          type="button"
          onClick={() => setShowLeads((o) => !o)}
          className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showLeads ? 'Hide leads' : 'View leads →'}
        </button>
      </div>
      {showLeads && (
        <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <LeadsList practiceId={practiceId} win={win} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="pb-2 text-left text-xs text-slate-400">
            {practiceId ? 'The selected practice.' : 'Every practice with a linked GoHighLevel subaccount.'}
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Practice</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 text-right font-medium">Leads</th>
              <th className="py-2 pr-3 text-right font-medium">Accepted</th>
              <th className="py-2 pr-3 text-right font-medium">Conv %</th>
              <th className="py-2 pr-3 text-right font-medium">Value accepted</th>
            </tr>
          </thead>
          <tbody>
            {practiceRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  No Google or Facebook pipeline leads in this window.
                </td>
              </tr>
            ) : (
              practiceRows.map((p) => (
                <Fragment key={p.practiceId ?? 'unmapped'}>
                  {CHANNELS.map((ch, i) => {
                    const c = p.byChannel.get(ch.key);
                    return (
                      <tr key={`${p.practiceId ?? 'unmapped'}-${ch.key}`} className="border-b border-slate-100">
                        {i === 0 ? (
                          <td className="py-2 pr-3 font-medium text-slate-900" rowSpan={CHANNELS.length}>
                            {p.practiceName ?? 'Unmapped practice'}
                          </td>
                        ) : null}
                        <td className="py-2 pr-3 text-slate-600">{ch.label}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(c?.leads ?? 0)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(c?.conversions ?? 0)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{rate(c?.conversions ?? 0, c?.leads ?? 0)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatPence(c?.matchedValuePence ?? 0)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))
            )}
          </tbody>
          <tfoot>
            {CHANNELS.map((ch) => {
              const g = data.group[ch.key];
              return (
                <tr key={`total-${ch.key}`} className="border-t-2 border-slate-200 font-medium text-slate-900">
                  <td className="py-2 pr-3">Group total</td>
                  <td className="py-2 pr-3">{ch.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(g.leads)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(g.conversions)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{rate(g.conversions, g.leads)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatPence(g.matchedValuePence)}</td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>

      <p className="mt-3 max-w-3xl text-xs text-slate-400">
        Ad spend, cost per lead and return on ad spend are group-level only — the ad platforms don&rsquo;t tell us which
        practice a pound of spend went to (one ad account can serve several practices), so a per-practice figure would be
        a guess. Facebook spend shows as &mdash; when the Meta account needs reconnecting under System &gt; Integrations.
      </p>
    </section>
  );
}
