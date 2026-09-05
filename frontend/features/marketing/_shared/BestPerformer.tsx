'use client';
// ============================================================================
// "Which one is doing well?" for the tiers BELOW campaign — ad group, ad,
// keyword.
//
// ============================================================================
// WHY THIS RANKS ON GOOGLE'S CONVERSIONS AND THE CAMPAIGN CARD DOES NOT
//
// The campaign card ranks on money: what a campaign collected against what it
// cost, from real patients matched in Dentally. That is the better measure and
// it is used wherever it can be.
//
// It cannot be used here. Measured on live data for a one-month window: 179 of
// 262 leads resolve to a campaign (68%), but only 52 resolve to an AD GROUP
// (20%) and 12 of those became patients — and NO lead resolves to an
// individual ad at all, because nothing stored can tie one to an ad (only
// Google's click_view can, keyed on gclid, 90 days, one day per query).
//
// Ranking three tiers on 12 patients would produce a confident winner out of
// noise, and ranking ads that way is not possible even in principle. So these
// three rank on the one measure Google reports completely at every grain — its
// own tracked conversions — and each card SAYS SO on its face, because a
// reader who assumes these are patients will act on the wrong number.
//
// Google's conversions count conversion ACTIONS, not people. They will never
// equal the lead and patient figures on the campaign card, and are not
// supposed to.
//
// ============================================================================
// LOWEST COST PER CONVERSION, WITH THE DENOMINATOR ON THE CARD
//
// Among entities that both SPENT and CONVERTED. Requiring both is what stops a
// £2 ad with one modelled conversion topping a £900 one with forty: the
// evidence line always names the conversion count and the spend behind the
// ratio, so a winner resting on 1.5 conversions is visibly that.
//
// The window comes from the shared scope bar, exactly as the tables beneath do
// — change the period and the winner changes with it.
// ============================================================================
import { money, money0, num, conversions as fmtConversions } from './format';

export interface Performer {
  id: string | null;
  name: string | null;
  spendPence: number;
  conversions: number;
  costPerConversionPence: number | null;
}

/**
 * The cheapest converter in the list, or null when nothing qualifies.
 *
 * Ties break on conversion COUNT descending: between two entities at the same
 * cost per conversion, the one that produced more of them is the more
 * trustworthy answer, not an arbitrary pick.
 */
export function bestByCostPerConversion<T extends Performer>(rows: T[]): T | null {
  const eligible = rows.filter(
    (r) => r.spendPence > 0 && r.conversions > 0 && r.costPerConversionPence !== null,
  );
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => (a.costPerConversionPence! - b.costPerConversionPence!)
    || (b.conversions - a.conversions))[0];
}

export function BestPerformer({
  label,
  row,
  fallbackName,
  extra,
  note,
  onOpen,
}: {
  label: string;
  row: Performer | null;
  fallbackName: string;
  /** One SHORT fact, appended inline to the evidence line — a match type, a
   *  quality score. Never the ranking basis, and never a sentence: it sits
   *  after a middot and a sentence there reads as a run-on. */
  extra?: string | null;
  /** A full sentence, on its own line. What did NOT qualify, usually. */
  note?: string | null;
  onOpen?: () => void;
}) {
  // No card at all rather than a card full of em dashes. "Nothing converted in
  // this period" is a fact the table below already shows; repeating it in a
  // highlight adds nothing and takes the eye first.
  if (!row) return null;

  const body = (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </span>
      </div>
      <p className="mt-2 truncate text-[14px] font-medium text-ink">{row.name ?? fallbackName}</p>
      <p className="mt-1 font-display text-[20px] leading-none text-brand-700">
        {money(row.costPerConversionPence)}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
        per conversion · {fmtConversions(row.conversions)} from {money0(row.spendPence)}
        {extra ? ` · ${extra}` : ''}
      </p>
      {note && <p className="mt-1 text-[11px] leading-snug text-ink-muted">{note}</p>}
      {/* The basis, on the card. Without this line a reader compares "£38 per
          conversion" here against "£430 per patient" on the campaign card and
          concludes something false about both. */}
      <p className="mt-2 text-[11px] leading-snug text-ink-muted">
        Ranked on Google&apos;s own tracked conversions — not patients. Lead attribution does not
        reach this level.
      </p>
    </>
  );

  if (!onOpen) {
    return (
      <div className="flex-1 rounded-panel border border-border bg-surface px-5 py-4 shadow-panel-sm">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex-1 rounded-panel border border-border bg-surface px-5 py-4 text-left shadow-panel-sm transition-colors hover:border-brand-200 hover:bg-brand-50/30"
    >
      {body}
    </button>
  );
}

/** Count of entities that could not be ranked, for an honest caveat line. */
export function unrankedNote(rows: Performer[]): string | null {
  const noConv = rows.filter((r) => r.spendPence > 0 && r.conversions === 0).length;
  if (noConv === 0) return null;
  return `${num(noConv)} more spent in this period without a tracked conversion.`;
}
