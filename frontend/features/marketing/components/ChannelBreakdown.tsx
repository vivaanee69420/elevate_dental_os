// Where the money went, by channel, and what it bought.
//
// "Patients" and "Platform conversions" are DIFFERENT NUMBERS and sit in
// separate columns on purpose: Google and Facebook count a form submission,
// this counts someone matched to a Dentally record. Presenting either as the
// other is how a channel comes to look three times better than it is.
//
// The rows sum to the tiles above — same campaigns, same people.
import { formatPence } from '@/lib/format';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type ChannelRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const num = (n: number) => n.toLocaleString('en-GB');

export function ChannelBreakdown({ rows }: { rows: ChannelRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface">
      <table className="w-full text-[13.5px]">
        <caption className="px-4 pt-4 text-left">
          <span className="block text-[14px] font-medium text-ink">By channel</span>
          <span className="mt-0.5 block text-[13px] font-normal text-ink-muted">
            Platform conversions are what Google and Facebook counted. Patients are
            people matched to a Dentally record — the two rarely agree, and only the
            second is a patient.
          </span>
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Spend</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Campaigns</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Clicks</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Platform conversions</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Leads</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per lead</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Patients</th>
            <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per patient</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="border-t border-border">
              <td className="px-4 py-3">
                <span className="flex items-center gap-2 font-medium text-ink">
                  {/* The dot carries channel identity; the label carries it too,
                      so the row never depends on colour alone. */}
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: CHANNEL_COLOUR[r.provider] }}
                  />
                  {CHANNEL_LABEL[r.provider] ?? r.provider}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.spendPence)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{num(r.campaigns)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{num(r.clicks)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{num(r.platformConversions)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{num(r.leads)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerLeadPence)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{num(r.patients)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerPatientPence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
