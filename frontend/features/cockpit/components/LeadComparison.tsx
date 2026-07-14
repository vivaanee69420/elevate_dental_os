'use client';
// LeadComparison — Google vs Facebook leads/conversions per practice, matched
// to Emergent-accepted treatments by phone/email (Task 1's channel-breakdown
// matcher). Ad spend + CPL/ROI are shown at GROUP level only: per-practice
// spend isn't attributable from the ad platforms today (a single account can
// serve several practices), so a per-row spend figure would be a guess.
import { Fragment, useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useCockpitLeads } from '../hooks';
import { PipelineTag } from './PipelineTag';
import type { LeadRoi, LeadChannel } from '../api';

function rate(n: number, d: number): string {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function roiText(valuePence: number, spendPence: number): string {
  if (!spendPence) return '—';
  return `${(valuePence / spendPence).toFixed(1)}×`;
}

const CHANNELS: Array<{ key: 'google' | 'facebook'; label: string }> = [
  { key: 'google', label: 'Google' },
  { key: 'facebook', label: 'Facebook' },
];

function fmtDate(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The leads list — fetched only once "View leads" is opened. Fetched WITHOUT
// a channel param (up to 500 rows) and grouped/filtered by channel
// CLIENT-SIDE: the backend's channel filter runs after classification, so it
// can short a page — grouping locally over the full fetch avoids that.
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

  const byChannel = new Map<LeadChannel, typeof lines>();
  for (const l of lines) {
    if (!byChannel.has(l.channel)) byChannel.set(l.channel, []);
    byChannel.get(l.channel)!.push(l);
  }
  const order: LeadChannel[] = ['google', 'facebook', 'website', 'instagram', 'other'];

  return (
    <div className="space-y-4">
      {order
        .filter((ch) => byChannel.has(ch))
        .map((ch) => {
          const rows = byChannel.get(ch)!;
          return (
            <div key={ch}>
              <div className="mb-2 flex items-center gap-2">
                <PipelineTag channel={ch} />
                <span className="text-xs text-slate-400">{formatNumber(rows.length)} lead{rows.length === 1 ? '' : 's'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Phone</th>
                      <th className="py-2 pr-3 font-medium">Pipeline</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                      <th className="py-2 pr-3 text-right font-medium">Converted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 text-slate-900">{l.name ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-600">{l.email ?? '—'}</td>
                        <td className="py-2 pr-3 text-slate-600">{l.phone ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <PipelineTag channel={l.channel} pipelineName={l.pipelineName} />
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{fmtDate(l.createdAt)}</td>
                        <td className="py-2 pr-3 text-right">
                          {l.converted ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">
                              ✓ {formatPence(l.matchedValuePence)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      {lines.length === (data?.limit ?? 0) && (
        <p className="text-xs text-slate-400">Showing the first {data?.limit} leads — narrow the period or practice to see fewer at once.</p>
      )}
    </div>
  );
}

export function LeadComparison({
  data,
  practiceId,
  win,
}: {
  data: LeadRoi;
  practiceId?: string;
  win: { since: string; until: string };
}) {
  const [showLeads, setShowLeads] = useState(false);
  const rowsByPractice = new Map<string, { practiceId: string | null; practiceName: string | null; byChannel: Map<string, LeadRoi['channels'][number]> }>();
  for (const c of data.channels) {
    const key = c.practiceId ?? '__unmapped__';
    if (!rowsByPractice.has(key)) {
      rowsByPractice.set(key, { practiceId: c.practiceId, practiceName: c.practiceName, byChannel: new Map() });
    }
    rowsByPractice.get(key)!.byChannel.set(c.channel, c);
  }
  const practiceRows = Array.from(rowsByPractice.values());

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">
            3
          </span>
          Leads — Google vs Facebook
        </h2>
        <span className="text-xs text-slate-400">Matched to accepted treatments by phone/email</span>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[13px] text-slate-500">See every individual lead with its channel, pipeline and conversion outcome.</span>
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
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Practice</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 text-right font-medium">Leads</th>
              <th className="py-2 pr-3 text-right font-medium">Conversions</th>
              <th className="py-2 pr-3 text-right font-medium">Conv %</th>
            </tr>
          </thead>
          <tbody>
            {practiceRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
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
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHANNELS.map((ch) => {
          const g = data.group[ch.key];
          const spend = data.spendByChannel[ch.key];
          return (
            <div key={`spend-${ch.key}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">{ch.label} ad spend (group)</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-lg font-semibold text-slate-900">{formatPence(spend)}</span>
                <span className="text-[13px] text-slate-500">
                  CPL {g.leads ? formatPence(Math.round(spend / g.leads)) : '—'}
                </span>
                <span className="text-[13px] text-slate-500">ROI {roiText(g.matchedValuePence, spend)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Ad spend, cost-per-lead and ROI are shown at group level only — per-practice spend isn&rsquo;t attributable
        from the ad platforms yet (one ad account can serve several practices). Facebook spend may be stale if
        the account needs reconnecting under System &gt; Integrations.
      </p>
    </section>
  );
}
