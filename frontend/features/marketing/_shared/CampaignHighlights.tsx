'use client';
// ============================================================================
// "Which campaign is doing well?" — answered in two cards, with the evidence
// on the card rather than behind it.
//
// ============================================================================
// WHAT "PERFORMING WELL" IS DEFINED AS HERE, AND WHY IT IS NOT CPA
//
// The obvious pick is lowest cost per accepted patient. It is the wrong one.
// CPA rewards a campaign for producing ONE cheap patient and says nothing
// about what that patient was worth — and in dentistry that is the whole
// question: a £200 hygiene patient and a £4,000 implant patient both cost the
// same to acquire and are not remotely the same outcome. Ranking on CPA would
// promote the campaign selling the cheapest treatment.
//
// So the measure is RETURN: money actually collected from a campaign's
// patients, against what that campaign cost. It is the only figure on this
// page that answers "did this make money", and it is available because the
// ledger already ties payments to leads.
//
// ============================================================================
// THE THREE GUARDS, none of them optional
//
//  1. A CAMPAIGN WITH NO ACCEPTED PATIENT CANNOT WIN. Without this a campaign
//     that spent £3 and collected £40 from a single exam fee ranks above one
//     that spent £2,000 and collected £3,900 from five patients, on a 13x that
//     means nothing. Winning requires at least one patient over the acceptance
//     floor.
//
//  2. THE DENOMINATOR IS ON THE CARD. "2.0x" is not shown alone — it is shown
//     as "£3,920 collected from £1,941, 5 patients from 28 leads", so a reader
//     can see immediately whether the ratio rests on five patients or on one.
//     A single-patient winner is a real answer to a small question, and the
//     card must not disguise which it is.
//
//  3. NEITHER CARD APPEARS WITHOUT A QUALIFYING CAMPAIGN. No winner is shown
//     when nothing has produced a patient yet; the card says that instead of
//     promoting whatever sorted first.
//
// ============================================================================
// THE SECOND CARD IS NOT "WORST", IT IS "WATCH"
//
// The useful opposite of a winner is not the lowest ratio — it is the campaign
// taking the most money while producing no patients at all, because that is
// the one with a decision attached to it. A campaign with a poor ratio is
// still working; a campaign with £782 spent and nothing accepted may simply be
// young, which is why the card says "no patients YET" and the caveat below
// says money keeps arriving after a period closes.
// ============================================================================
import { money0, money, num, multiple } from './format';

// STRUCTURAL, not tied to one platform. Google and Facebook both produce
// campaign rows in this shape (lib/marketing/lead-performance.js builds both),
// and the "best return / most spent, no patients yet" judgement is identical
// either way — a second copy would be a second definition of "best" free to
// drift from this one.
export interface HighlightCampaign {
  campaignId: string | null;
  campaignName: string | null;
  attributed: boolean;
  spendPence: number;
  leads: number;
  booked: number;
  accepted: number;
  paidPence: number;
  returnOnSpend: number | null;
  cplPence: number | null;
  cpaPence: number | null;
}

function pickBest(rows: HighlightCampaign[]): HighlightCampaign | null {
  const eligible = rows.filter(
    (r) => r.attributed && r.spendPence > 0 && r.accepted > 0 && r.returnOnSpend !== null,
  );
  if (eligible.length === 0) return null;
  // Ties broken by patient count, then spend: between two campaigns at the
  // same return, the one that proved it on more patients and more money is the
  // more trustworthy answer.
  return eligible.sort((a, b) => (b.returnOnSpend! - a.returnOnSpend!)
    || (b.accepted - a.accepted)
    || (b.spendPence - a.spendPence))[0];
}

function pickWatch(rows: HighlightCampaign[]): HighlightCampaign | null {
  const eligible = rows.filter((r) => r.attributed && r.spendPence > 0 && r.accepted === 0);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => b.spendPence - a.spendPence)[0];
}

function Card({
  label, tone, campaign, headline, evidence, onOpen,
}: {
  label: string;
  tone: 'good' | 'watch';
  campaign: string;
  headline: string;
  evidence: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex-1 rounded-panel border border-border bg-surface px-5 py-4 text-left shadow-panel-sm transition-colors hover:border-brand-200 hover:bg-brand-50/30"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${tone === 'good' ? 'bg-brand' : 'bg-warning'}`}
        />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </span>
      </div>
      <p className="mt-2 truncate text-[14px] font-medium text-ink">{campaign}</p>
      <p className={`mt-1 font-display text-[20px] leading-none ${tone === 'good' ? 'text-brand-700' : 'text-ink'}`}>
        {headline}
      </p>
      {/* The denominator, always. See guard 2 in this file's header. */}
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">{evidence}</p>
      <p className="mt-2 text-[11.5px] text-brand opacity-0 transition-opacity group-hover:opacity-100">
        See its leads →
      </p>
    </button>
  );
}

export function CampaignHighlights({
  campaigns,
  onOpenCampaign,
}: {
  campaigns: HighlightCampaign[];
  /** Switches to the Campaigns tab and opens that campaign's row. */
  onOpenCampaign: (campaignId: string) => void;
}) {
  const best = pickBest(campaigns);
  const watch = pickWatch(campaigns);

  // Nothing worth highlighting. Silence rather than an empty pair of cards —
  // a card that says "—" twice is worse than no card.
  if (!best && !watch) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        {best && (
          <Card
            label="Best return this period"
            tone="good"
            campaign={best.campaignName ?? best.campaignId ?? 'Unnamed campaign'}
            headline={`${multiple(best.returnOnSpend)} of spend`}
            evidence={`${money0(best.paidPence)} collected from ${money0(best.spendPence)} · `
              + `${num(best.accepted)} patient${best.accepted === 1 ? '' : 's'} from ${num(best.leads)} leads`
              + `${best.cpaPence === null ? '' : ` · ${money(best.cpaPence)} each`}`}
            onOpen={() => best.campaignId && onOpenCampaign(best.campaignId)}
          />
        )}
        {watch && (
          <Card
            label="Most spent, no patients yet"
            tone="watch"
            campaign={watch.campaignName ?? watch.campaignId ?? 'Unnamed campaign'}
            headline={money0(watch.spendPence)}
            evidence={`${num(watch.leads)} lead${watch.leads === 1 ? '' : 's'}, `
              + `${num(watch.booked)} booked, none accepted yet`
              + `${watch.cplPence === null ? '' : ` · ${money(watch.cplPence)} per lead`}`}
            onOpen={() => watch.campaignId && onOpenCampaign(watch.campaignId)}
          />
        )}
      </div>
      {/* Acceptance has no upper bound — money counts whenever it arrives — so
          a campaign that started recently has had less time to collect than
          one that ran all period. Stated because the "no patients yet" card
          would otherwise read as a verdict on a campaign two weeks old. */}
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Money collected keeps arriving after a period closes, so a campaign that started recently
        has had less time to show a return than one that ran throughout.
      </p>
    </div>
  );
}
