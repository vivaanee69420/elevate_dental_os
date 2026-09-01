// The five campaigns taking the most money, as a summary. The full list, with
// filtering, is the Campaigns tab — this is the "what should I look at" glance,
// not a second copy of that table.
import Link from 'next/link';
import { formatPence } from '@/lib/format';
import { CHANNEL_COLOUR, CHANNEL_LABEL, type CampaignRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const TOP_N = 5;

export function TopCampaigns({ rows }: { rows: CampaignRow[] }) {
  if (rows.length === 0) return null;
  const top = rows.slice(0, TOP_N);   // already ordered by spend
  const maxSpend = top[0]?.spendPence || 1;

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-ink">Where the money went</span>
        {rows.length > TOP_N ? (
          <Link href="/marketing-campaigns" className="text-[13px] font-medium text-brand hover:underline">
            All
            {' '}
            {rows.length}
            {' '}
            campaigns
          </Link>
        ) : null}
      </div>
      <p className="mb-3 text-[13px] text-ink-muted">
        The biggest spends this period, with what each one actually bought.
      </p>
      <ul className="flex flex-col gap-3">
        {top.map((r) => (
          <li key={`${r.provider}-${r.campaignId}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CHANNEL_COLOUR[r.provider] }}
                />
                <span className="truncate text-[13.5px] text-ink" title={r.campaignName ?? r.campaignId}>
                  {r.campaignName ?? r.campaignId}
                </span>
                <span className="shrink-0 text-[12.5px] text-ink-muted">
                  {CHANNEL_LABEL[r.provider] ?? r.provider}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-[13.5px] font-medium text-ink">
                {money(r.spendPence)}
              </span>
            </div>
            {/* Length encodes spend against the largest campaign — the same
                comparison the eye would otherwise have to make across a column
                of numbers. Anchored at the baseline, 4px ends. */}
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-[4px] bg-bg">
              <div
                className="h-full rounded-[4px]"
                style={{
                  width: `${Math.max(2, Math.round((r.spendPence / maxSpend) * 100))}%`,
                  background: CHANNEL_COLOUR[r.provider],
                }}
              />
            </div>
            <div className="mt-1 text-[12.5px] text-ink-muted">
              {r.leads.toLocaleString('en-GB')}
              {r.leads === 1 ? ' lead' : ' leads'}
              {' · '}
              {money(r.costPerLeadPence)}
              {' each · '}
              {r.patients.toLocaleString('en-GB')}
              {r.patients === 1 ? ' became a patient' : ' became patients'}
              {r.patients > 0 ? ` at ${money(r.costPerPatientPence)}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
