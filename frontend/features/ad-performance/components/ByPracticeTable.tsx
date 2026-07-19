'use client';
// Same metrics as the scorecard, per practice. A practice with no mapped ad
// account shows spend and cost per lead as "Not reporting" rather than £0 —
// the same rule the rest of the product follows for a practice with no feed.
//
// Each practice's deduped `total` row is rendered alongside its three channel
// rows so nobody is tempted to sum the channel columns — a person who
// enquired through both a Google-tagged and a Facebook-tagged pipeline counts
// once under EACH channel (correct for comparison), so summing inflates leads
// and revenue. `total` is the true, non-additive figure.
import { formatPence } from '@/lib/format';
import { Card } from '@/components/ui';
import type { PracticeChannels, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  unassigned: 'Unassigned',
};

// Load-bearing null guard — formatPence() must never be called directly on a
// nullable pence value anywhere in this file.
const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));

export function ByPracticeTable({ rows }: { rows: PracticeChannels[] }) {
  return (
    <Card>
      <h2 className="mb-2 text-[15px] font-semibold text-slate-900">By practice</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">Practice</th>
              <th className="py-2 pr-3 font-medium">Channel</th>
              <th className="py-2 pr-3 text-right font-medium">Leads</th>
              <th className="py-2 pr-3 text-right font-medium">Spend</th>
              <th className="py-2 pr-3 text-right font-medium">Cost per lead</th>
              <th className="py-2 pr-3 text-right font-medium">Conversions</th>
              <th className="py-2 pr-3 text-right font-medium">Accepted value</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((p) => [
              ...p.channels.map((c, i) => (
                <tr key={`${p.practiceId}|${c.channel}`} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-900">{i === 0 ? (p.practiceName ?? '—') : ''}</td>
                  <td className="py-2 pr-3 text-slate-600">{LABEL[c.channel]}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{c.leads.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{money(c.spendPence)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{money(c.costPerLeadPence)}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{c.conversions.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatPence(c.acceptedValuePence)}</td>
                </tr>
              )),
              <tr key={`${p.practiceId}|total`} className="border-b border-slate-200 bg-slate-50 font-medium">
                <td className="py-2 pr-3 text-slate-900"></td>
                <td className="py-2 pr-3 text-slate-900">Total (deduped)</td>
                <td className="py-2 pr-3 text-right text-slate-900">{p.total.leads.toLocaleString('en-GB')}</td>
                <td className="py-2 pr-3 text-right text-slate-900">{money(p.total.spendPence)}</td>
                <td className="py-2 pr-3 text-right text-slate-900">{money(p.total.costPerLeadPence)}</td>
                <td className="py-2 pr-3 text-right text-slate-900">{p.total.conversions.toLocaleString('en-GB')}</td>
                <td className="py-2 pr-3 text-right text-slate-900">{formatPence(p.total.acceptedValuePence)}</td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="py-3 text-sm text-slate-500">No practice data in this period.</p> : null}
      {rows.length > 0 ? (
        <p className="mt-2 text-[11px] text-slate-400">
          The three channel rows are not additive — a person who enquired through more than one
          channel counts once under each. Use the &quot;Total (deduped)&quot; row for the practice&apos;s
          true lead count.
        </p>
      ) : null}
    </Card>
  );
}
