'use client';
// Shared lead table — one row per PERSON, tagged with the GoHighLevel pipeline
// they came in on. Used by the Google-vs-Facebook section (grouped by channel)
// and by the "New leads" drill-down (flat, every channel), so the two can never
// show the same lead differently.
import { formatPence } from '@/lib/format';
import { PipelineTag } from './PipelineTag';
import type { CockpitLeadLine, LeadChannel } from '../api';

export type LeadRow = CockpitLeadLine & { alsoIn: string[] };

export const CHANNEL_ORDER: LeadChannel[] = ['google', 'facebook', 'website', 'instagram', 'other'];

export function fmtLeadDate(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Collapse the raw pipeline rows to one row per person (per channel) so a list
// ties exactly to the count above it. The other pipelines a person appears in
// are kept as a "+N more" hint rather than dropped.
export function dedupeByPerson(lines: CockpitLeadLine[], perChannel = true): LeadRow[] {
  const byPerson = new Map<string, LeadRow>();
  for (const l of lines) {
    const who = l.contactId ?? `lead:${l.id}`;
    const key = perChannel ? `${l.channel}|${who}` : who;
    const seen = byPerson.get(key);
    if (!seen) {
      byPerson.set(key, { ...l, alsoIn: [] });
      continue;
    }
    // Keep the earliest entry (first touch) as the row, note the other pipeline.
    const earlier = Date.parse(l.createdAt) < Date.parse(seen.createdAt) ? l : seen;
    const later = earlier === l ? seen : l;
    const alsoIn = [...seen.alsoIn];
    if (later.pipelineName && !alsoIn.includes(later.pipelineName)) alsoIn.push(later.pipelineName);
    byPerson.set(key, { ...earlier, alsoIn });
  }
  return Array.from(byPerson.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  return (
    <div className="overflow-x-auto" style={{ maxHeight: 420 }}>
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Phone</th>
            <th className="py-2 pr-3 font-medium">Came in on</th>
            <th className="py-2 pr-3 font-medium">Created</th>
            <th className="py-2 pr-3 font-medium">Treatment accepted</th>
            <th className="py-2 pr-3 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-b border-slate-100">
              <td className="py-2 pr-3 text-slate-900">{l.name ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{l.email ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{l.phone ?? '—'}</td>
              <td className="py-2 pr-3">
                <span className="flex flex-wrap items-center gap-1">
                  <PipelineTag channel={l.channel} pipelineName={l.pipelineName} />
                  <span className="text-[12px] text-slate-500">{l.pipelineName ?? '—'}</span>
                  {l.alsoIn.length > 0 ? (
                    <span className="text-[11px] text-slate-400" title={`Also in: ${l.alsoIn.join(', ')}`}>
                      +{l.alsoIn.length} more
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{fmtLeadDate(l.createdAt)}</td>
              <td className="py-2 pr-3 text-slate-600">{l.matchedTreatmentName ?? '—'}</td>
              <td className="py-2 pr-3 text-right">
                {l.converted ? (
                  <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">
                    {formatPence(l.matchedValuePence)}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="py-3 text-sm text-slate-500">No leads to show.</p> : null}
    </div>
  );
}
