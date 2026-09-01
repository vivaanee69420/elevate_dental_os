// Facebook and Google, side by side, each with its own money.
//
// The tiles above blend every channel into one cost per lead. That is the right
// summary but the wrong operating number: a practice can spend on Facebook
// only, take a third of its leads from Google, and see a "cost per lead" that
// belongs to neither. These cards are the split — one card per channel, each
// dividing that channel's spend by that channel's leads.
//
// "Other sources" is organic social, referral, direct and untracked traffic. It
// shows leads and patients but never a cost, because no advertising bought it.
import { formatPence } from '@/lib/format';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type ChannelRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const num = (n: number) => n.toLocaleString('en-GB');

function Figure({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 text-[17px] font-semibold tabular-nums ${muted ? 'text-ink-muted' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

function ChannelCard({ row, totalLeads }: { row: ChannelRow; totalLeads: number }) {
  const isOther = row.channel === 'other';
  const share = totalLeads > 0 ? Math.round((row.leads / totalLeads) * 100) : 0;

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: CHANNEL_COLOUR[row.channel] }}
        />
        <span className="text-[14px] font-medium text-ink">
          {CHANNEL_LABEL[row.channel] ?? row.channel}
        </span>
        <span className="ml-auto text-[12.5px] text-ink-muted">
          {share}
          % of leads
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Figure label="Spend" value={isOther ? '—' : money(row.spendPence)} muted={isOther} />
        <Figure label="Leads" value={num(row.leads)} />
        <Figure label="Cost per lead" value={money(row.costPerLeadPence)} />
        <Figure label="Patients" value={num(row.patients)} />
        <Figure label="Cost per patient" value={money(row.costPerPatientPence)} />
        <Figure
          label="Campaigns"
          value={isOther ? '—' : num(row.campaigns)}
          muted={isOther}
        />
      </div>

      {isOther ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
          Organic social, referrals, direct enquiries and leads with no ad tracking.
          No advertising bought these, so they carry no cost.
        </p>
      ) : null}

      {!isOther && row.spendPence === 0 && row.leads > 0 ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
          These leads came through
          {' '}
          {CHANNEL_LABEL[row.channel]}
          {' '}
          but no spend was recorded on it in this period — the ads that won them
          ran earlier, or on an account with no practice mapping. Cost per lead is
          left blank rather than shown as £0.00.
        </p>
      ) : null}
    </div>
  );
}

export function ChannelCards({ rows }: { rows: ChannelRow[] }) {
  if (rows.length === 0) return null;
  const totalLeads = rows.reduce((n, r) => n + r.leads, 0);

  return (
    <div>
      <div className="mb-1 text-[14px] font-medium text-ink">Facebook and Google, separately</div>
      <p className="mb-3 text-[13px] text-ink-muted">
        Each channel&apos;s own spend against its own leads. The tiles above blend all
        of them into one figure, which belongs to no single channel when the two
        perform differently — or when only one of them is spending.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {rows.map((r) => (
          <ChannelCard key={r.channel} row={r} totalLeads={totalLeads} />
        ))}
      </div>
    </div>
  );
}
