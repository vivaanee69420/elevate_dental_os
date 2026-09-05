'use client';
// ============================================================================
// The people behind a campaign's number.
//
// A campaign row says it produced 28 leads and 5 patients. This says WHO —
// what they searched for, when they got in touch, whether they booked and what
// they have paid. That is the difference between a report you read and a
// report you act on: "PMAX Cosmetic Dentistry returned 2.0x" is an argument,
// and the five names underneath it are the evidence.
//
// COSTS NO REQUEST. Every lead already carries its own campaignId, adGroupId
// and keywordText (migration 000165), and the whole deduplicated set is
// already in the page's cache for the summary rail. This filters that array.
//
// A PLAIN TABLE, NOT A DataGrid. This is nested inside an expanded row, and a
// second sortable grid in there — its own sticky header, its own sort state,
// its own horizontal scroll — is a table inside a table row, which is the
// boxes-inside-boxes shape this redesign is undoing. Small, quiet, readable.
// ============================================================================
import { formatDate } from '@/lib/format';
import { Chip } from '../../_shared/Bars';
import { money, num, DASH } from '../../_shared/format';
import type { GoogleLeadRow } from '../api';

// Enough to see the shape of a campaign's intake without turning an expanded
// row into a page of its own. The remainder is COUNTED, never silently cut —
// a list that stops without saying so is the same class of lie as a truncated
// total.
const LIMIT = 25;

export function CampaignLeads({
  leads,
  campaignId,
  attributed,
}: {
  leads: GoogleLeadRow[];
  campaignId: string | null;
  /** false for the "Not attributed" bucket, whose leads are the ones with a
   *  null campaignId — a real selection, not an absence of one. */
  attributed: boolean;
}) {
  const mine = leads.filter((l) => (attributed ? l.campaignId === campaignId : l.campaignId === null));

  if (mine.length === 0) {
    return (
      <p className="text-[12px] text-ink-muted">
        No leads recorded against this campaign in the selected period.
      </p>
    );
  }

  const shown = mine
    .slice()
    // Money first: the reader opened this to see who paid, and a patient who
    // paid £3,900 should not be below someone who rang and never returned.
    // Date descending breaks ties so the recent end of a quiet list is on top.
    .sort((a, b) => (b.paidPence - a.paidPence) || b.leadAt.localeCompare(a.leadAt))
    .slice(0, LIMIT);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
        Leads from this campaign ({num(mine.length)})
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-ink-muted">
              <th className="border-b border-border pb-1 pr-3 text-left font-semibold">Name</th>
              <th className="border-b border-border pb-1 pr-3 text-left font-semibold">Searched for</th>
              <th className="border-b border-border pb-1 pr-3 text-left font-semibold">Treatment</th>
              <th className="border-b border-border pb-1 pr-3 text-right font-semibold">Date</th>
              <th className="border-b border-border pb-1 pr-3 text-right font-semibold">Booked</th>
              <th className="border-b border-border pb-1 text-right font-semibold">Paid since</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={`${l.phone ?? 'x'}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3 align-top">
                  <span className="text-ink">{l.name ?? DASH}</span>
                  {l.phone && <span className="block text-[11px] text-ink-muted">{l.phone}</span>}
                </td>
                <td className="py-1.5 pr-3 align-top">
                  {/* The exact search that bought this person, where we have
                      it. Only calls carry a keyword, and Performance Max never
                      does, so the ad group is the honest fallback and a plain
                      dash is the honest last resort. */}
                  {l.keywordText
                    ? <span className="text-ink">&ldquo;{l.keywordText}&rdquo;</span>
                    : <span className="text-ink-muted">{l.adGroupName ?? DASH}</span>}
                  <span className="block text-[11px] text-ink-muted">
                    {l.source === 'callrail' ? 'Call' : 'Web form'}
                  </span>
                </td>
                <td className="py-1.5 pr-3 align-top text-ink-muted">{l.treatment ?? DASH}</td>
                <td className="py-1.5 pr-3 text-right align-top tabular-nums text-ink-muted">
                  {formatDate(l.leadAt)}
                  {(l.booked || l.accepted) && (
                    <span className="block text-[11px]">{l.isNewPatient ? 'New' : 'Existing'}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right align-top">
                  {l.booked ? <Chip tone="good">Yes</Chip> : DASH}
                </td>
                <td className="py-1.5 text-right align-top tabular-nums">
                  {/* £0.00 is a real answer here (paid nothing), not an unknown,
                      so it is NOT dashed out. It can also be negative when
                      refunds since the lead landed exceed payments. */}
                  <span className={l.accepted ? 'font-medium text-brand-700' : 'text-ink'}>
                    {money(l.paidPence)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine.length > LIMIT && (
        <p className="text-[11px] text-ink-muted">
          Showing the {LIMIT} who have paid the most. {num(mine.length - LIMIT)} more in this period.
        </p>
      )}
    </div>
  );
}
