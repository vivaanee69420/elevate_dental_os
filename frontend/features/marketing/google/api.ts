// Google report API client. NOTE the /api prefix: the Next proxy forwards
// the path verbatim, so omitting it 404s SILENTLY into an empty state — the
// same trap Task 4's Facebook page comment warns about, now bitten twice in
// this codebase.
//
// No organisation id is ever sent. The backend takes it from the session,
// which under an agency switch is already the sub-account — sending one
// would be a cross-tenant request.
//
// Same query-string convention as ../facebook/api.ts: the fetchers here take
// a pre-built query string (`qs`) rather than individual arguments, built by
// ../_shared/window.ts's ymdWindowParams — plain `YYYY-MM-DD`, both ends
// INCLUSIVE, because GoogleQuerySchema
// (backend/src/controllers/marketing.controller.js) requires that shape and
// campaignSpendByProvider()/ad_grain_rollup compare against plain DATE
// columns with `.gte(...).lte(...)`.
//
// Google's hierarchy is Campaign -> Ad Group -> { Ads, Keywords }: ads and
// keywords are SIBLINGS under an ad group, neither nested inside the other's
// response, which is why there are FOUR fetchers here where the Facebook
// client has three. `campaignId` narrows /ad-groups; `parentId` — an ad
// GROUP's own id, never a campaign id — narrows /ads and /keywords. Both are
// OPTIONAL, same shape/reasoning as the Facebook client's campaignId/adSetId.
import { api } from '@/lib/api';

// detail_not_synced: the campaign tier (ad_metrics) has real totals for this
// org, but THIS grain's own deep table (ad_google_adgroups/ad_google_ads/
// ad_google_keywords) has never received a row — the deep sync has not run
// yet, distinct from no_spend_in_window (both tables have synced before,
// just nothing in this window/filter). Never returned by campaigns(), whose
// own table already IS ad_metrics. See google-report.service.js's
// emptyWindowState.
export type GoogleState = 'not_connected' | 'never_synced' | 'detail_not_synced' | 'no_spend_in_window' | 'ok';

export interface GoogleExcludedAccount {
  customerId: string;
  name: string | null;
  /** Currently always 'unsupported_currency'. */
  reason: string;
  currency: string | null;
}

// The base cost/performance shape every one of the four grains returns.
// Google's own tracked conversions, present at EVERY grain (unlike Meta's
// `actions`, which are only requested at campaign grain) — see the file
// header on google-report.service.js. `conversions` is numeric, not an
// integer: Google reports modelled (fractional) conversions.
export interface GoogleRow {
  /** null only on the campaign tier's `totals` row. */
  id: string | null;
  name: string | null;
  status: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  /** null when there were no impressions. */
  ctr: number | null;
  /** null when there were no clicks. */
  cpcPence: number | null;
  /** Google's own tracked conversions. Fractional — never rounded. */
  conversions: number;
  /** null when conversions is zero. A cost per nothing is unknowable, not free. */
  costPerConversionPence: number | null;
  /** Present on ad-group/ad/keyword rows; absent (undefined) on campaign rows. */
  campaignId?: string | null;
  campaignName?: string | null;
  /** Present on ad/keyword rows only: the parent AD GROUP's id. */
  parentId?: string | null;
  /** Present on ad/keyword rows only: the parent AD GROUP's name. `null` when
   *  it could not be resolved (see google-report.service.js's
   *  parentAdGroupNames). MINOR 5: shown alongside campaignName in a row's
   *  subtitle — ad_grain_rollup groups by (entity_id, parent_id), and Google
   *  reuses a keyword's criterion id across ad groups, so the SAME id (and,
   *  for keywords, the same keyword text) can legitimately appear more than
   *  once under the SAME campaign; only the ad group tells those rows apart. */
  parentName?: string | null;
}

// The fields migration 000164 added, present on every Google row at every
// grain.
//
// EVERY ONE OF THESE CAN BE null, AND null IS NOT ZERO. Google does not report
// impression share for an individual ad, or conversion value for an account
// with no value-tracking conversion action. Rendering a null as 0 would claim
// a measurement nobody took: "0% impression share" reads as "you are
// invisible", which is a very different statement from "not measured here".
// Every formatter in ../_shared/format.ts returns an em dash for null for
// exactly this reason.
export interface GoogleExtras {
  /** Google's own tracked conversion VALUE, in integer pence. */
  conversionsValuePence: number | null;
  /** Includes the conversion actions Google keeps OUT of the headline
   *  `conversions` figure — call-extension phone calls among them, which for
   *  a dental practice is most of the point. */
  allConversions: number | null;
  /** conversionsValuePence / spendPence. null unless BOTH are known: a return
   *  on spend where the return is unknown is not 0x. */
  roas: number | null;
  /** 0-1. The share of the auctions you were eligible for that you actually
   *  showed in. Impression-weighted across the window — approximate, see
   *  GoogleApproximate. */
  searchImpressionShare: number | null;
  searchTopImpressionShare: number | null;
  searchAbsoluteTopImpressionShare: number | null;
  /** 0-1, and the actionable half: WHY the rest of the share was missed.
   *  Budget-lost means raise the budget; rank-lost means raise the bid or
   *  improve the ad. Together with the share itself these three sum to
   *  roughly 1. */
  searchBudgetLostImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
}

// Keyword rows additionally carry match type and Quality Score. See
// APPROXIMATE below for what "approximate" means for these.
export interface GoogleKeywordRow extends GoogleRow, GoogleExtras {
  matchType: string | null;
  /** 1-10, the LATEST value in the window — not an average. null if unknown. */
  qualityScore: number | null;
}

// Campaign rows carry Google's channel type, which is load-bearing rather
// than decorative: it is what explains a blank keyword column and a blank
// impression share on the SAME row. A reader who can see "Performance Max"
// understands the blank; one who cannot assumes the data is broken.
export interface GoogleCampaignRow extends GoogleRow, GoogleExtras {
  channelType: string | null;
  /** Calls straight from a call extension, as Google counts them. */
  phoneCalls: number | null;
}

// Ad rows carry the CREATIVE, and that is the point of pulling them.
// ad_group_ad.ad.name is an optional internal label almost nobody sets —
// measured on this org, 0 of 186 ads had one — so before this the Ads tab
// rendered a bare 12-digit id on every row. `name` now falls back to the
// ad's first responsive-search headline, which is what a human calls it.
export interface GoogleAdRow extends GoogleRow, GoogleExtras {
  adType: string | null;
  /** Google's own POOR / AVERAGE / GOOD / EXCELLENT grade. */
  adStrength: string | null;
  /** APPROVED / APPROVED_LIMITED / DISAPPROVED / AREA_OF_INTEREST_ONLY. */
  approvalStatus: string | null;
  /** The FIRST of the ad's final URLs. An ad may declare several; the field
   *  is named for what it is rather than pretending to be "the" URL. */
  finalUrl: string | null;
  /** Plain strings — the connector flattens Google's {text, pinnedField}
   *  assets, so no reader here needs to know that shape. */
  headlines: string[] | null;
  descriptions: string[] | null;
}

// A SEARCH TERM is what somebody actually typed, as opposed to what we bid
// on. It is not an object in the Google account and has no id of its own, so
// `id` and `name` are both the term TEXT.
export interface GoogleSearchTermRow extends GoogleRow, GoogleExtras {
  /** The keyword that CAUGHT this term — the actionable link. null when
   *  Google reported none (Performance Max has no keywords at all). */
  keywordText: string | null;
  matchType: string | null;
  /** Google's ADDED / EXCLUDED / NONE: whether anyone has already acted on
   *  this term. Without it the same rubbish term is re-reported as actionable
   *  every month after it has been excluded. */
  termStatus: string | null;
}

/** The two approximation statements keywords() always carries. Fixed text,
 *  not computed per request — see google-report.service.js's APPROXIMATE. */
export interface GoogleApproximate {
  impressionShare: string;
  qualityScore: string;
}

export interface GoogleCampaignsPayload {
  state: GoogleState;
  rows: GoogleCampaignRow[];
  excludedAccounts: GoogleExcludedAccount[];
  /** Same shape as a row's, with id/name/status null. null when rows is empty.
   *
   *  SUMS ARE SUMMED; RATIOS ARE NOT. Spend, impressions, clicks, conversions
   *  and value add up across campaigns. Impression share does NOT — it is a
   *  proportion of each campaign's own eligible auctions, and an average of
   *  proportions over different denominators has no referent — so every share
   *  is null on this row rather than being invented. */
  totals: GoogleCampaignRow | null;
  /** The window actually used. The deep-grain tables keep 92 days, so a
   *  longer request is clamped to what the finest grain can cover. */
  effectiveSince: string;
  /** True when the requested window started before that 92-day floor. */
  windowClamped: boolean;
}

export interface GoogleAdGroupRow extends GoogleRow, GoogleExtras {}

export interface GoogleAdGroupsPayload {
  state: GoogleState;
  /** No totals at this tier — matches the Facebook ad-set tier. */
  rows: GoogleAdGroupRow[];
  excludedAccounts: GoogleExcludedAccount[];
  effectiveSince: string;
  windowClamped: boolean;
}

export interface GoogleAdsPage {
  state: GoogleState;
  rows: GoogleAdRow[];
  /** Opaque; pass back verbatim as `cursor`. null on the last page. */
  nextCursor: string | null;
  excludedAccounts: GoogleExcludedAccount[];
  effectiveSince: string;
  windowClamped: boolean;
}

export interface GoogleKeywordsPage {
  state: GoogleState;
  rows: GoogleKeywordRow[];
  nextCursor: string | null;
  excludedAccounts: GoogleExcludedAccount[];
  /** Present on EVERY response, including not_connected/empty-window. */
  approximate: GoogleApproximate;
  effectiveSince: string;
  windowClamped: boolean;
}

export interface GoogleSearchTermsPage {
  state: GoogleState;
  rows: GoogleSearchTermRow[];
  nextCursor: string | null;
  excludedAccounts: GoogleExcludedAccount[];
  /** THE ONLY TIER WITH A WINDOW OF ITS OWN: search terms are kept for 30
   *  days, not the 92 every other deep grain holds. (term x ad group x day) is
   *  an order of magnitude more rows than any other grain, and the report is
   *  one you act on for recent traffic. Reported, never silent — the tab
   *  states the period it is actually showing. */
  windowDays: number;
  effectiveSince: string;
  windowClamped: boolean;
}

// Blended CPL/CPB/CPA cards (migration 000158) — PRACTICE grain, not
// per-campaign: Google carries no CRM lead funnel of its own and CallRail
// calls carry no ad/campaign linkage at all, so a per-campaign Google CPL
// cannot be built from what is stored. Spend is this practice's mapped
// Google account(s); leads are every GoHighLevel lead OR CallRail call for
// that SAME practice in the window, phone-deduplicated and Dentally-matched.
// See google-report.service.js's leadPerformance for the full reasoning.
export interface GoogleLeadPractice {
  /** null is the "unmapped" bucket — spend on an account with no practice
   *  mapping, or a lead whose practice could not be resolved. */
  practiceId: string | null;
  practiceName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  /** Deduplicated (by phone) count of GoHighLevel leads + CallRail calls. */
  leads: number;
  /** Of those, phone-matched to a Dentally patient with an appointment on or
   *  after the DAY the lead landed. */
  booked: number;
  /** Of those, phone-matched to a Dentally patient whose settled payments
   *  from the lead's own day onward — to date, with no upper bound — net of
   *  refunds, EXCEED the payload's acceptanceMinPaidPence (£40). Not "has a
   *  paid invoice": a floor is what separates committing to treatment from
   *  paying for the appointment.
   *
   *  Because it has no upper bound, a past period's figure IMPROVES as its
   *  leads convert. That is deliberate and matches `booked`; a funnel whose
   *  two halves answer different questions is worse than one that moves. */
  accepted: number;
  /** null when the corresponding denominator (leads/booked/accepted) is
   *  zero. A cost per nothing is unknowable, not free. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
}

// WHICH CAMPAIGN BOUGHT WHICH PATIENT — migration 000165, and the figure this
// page could never show before it. The service header used to say plainly
// that it was not buildable, on the belief that CallRail calls carried no
// campaign linkage. They carry three: the campaign name, the bid keyword and
// the gclid, all captured from the click.
export interface GoogleCampaignPerformance {
  /** null on the unattributed bucket ONLY. */
  campaignId: string | null;
  campaignName: string | null;
  /** SEARCH / PERFORMANCE_MAX / DISPLAY / VIDEO — what explains a blank
   *  keyword or impression share on the same row. */
  channelType: string | null;
  /** False on the single "Not attributed" bucket row.
   *
   *  THAT ROW IS RETURNED, NEVER DROPPED. If leads with no resolvable campaign
   *  simply vanished, the campaign rows would sum to fewer leads than the
   *  practice card above them and nothing would say so — every campaign's
   *  conversion rate would be overstated by a denominator smaller than the
   *  truth. It is rendered as an explicit row and sorted LAST regardless of
   *  size, because it is a caveat about the table rather than a row competing
   *  in it. */
  attributed: boolean;
  spendPence: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  leads: number;
  booked: number;
  accepted: number;
  /** Money actually collected from this campaign's patients, in pence. Counted
   *  for every eligible lead, not only those over the acceptance floor — a
   *  patient who paid £35 paid £35, and zeroing them because they sit below a
   *  threshold set for a different question would understate real revenue. */
  paidPence: number;
  /** All four are null on the unattributed bucket, which has no spend of its
   *  own — dividing its £0 by its leads would make the leads we could NOT
   *  attribute look like the cheapest campaign in the table. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
  /** paidPence / spendPence. null on zero spend — a return on nothing is not
   *  a return of zero. */
  returnOnSpend: number | null;
}

/** How much of the lead list could be tied to a campaign, and by which route.
 *  Published so the page can STATE its coverage rather than ask anyone to
 *  trust a per-campaign cost figure on faith — and so a regression (a renamed
 *  campaign the alias lookup misses, an edited CallRail tracking template)
 *  shows up as a visible shift here instead of a silent drift in CPA. */
export interface GoogleAttributionCoverage {
  total: number;
  attributed: number;
  /** callrail_keyword | callrail_campaign | ghl_campaign -> count. */
  byRoute: Record<string, number>;
  /** ghl | callrail -> count of leads with no campaign. The two gaps have
   *  different causes and different fixes. */
  unattributedBySource: Record<string, number>;
}

/** One deduplicated lead, for the cards' click-through drill-down list. */
export interface GoogleLeadRow {
  practiceId: string | null;
  practiceName: string | null;
  source: 'ghl' | 'callrail';
  /** ISO instant of the lead's own first touch (GHL lead created, or the
   *  CallRail call started) — whichever came first if both exist. */
  leadAt: string;
  /** UK-formatted (leading 0), e.g. "07598 983651" is NOT applied — plain
   *  "07598983651". null only when neither source carried a usable number
   *  (should not happen — both are required upstream to enter the ledger). */
  phone: string | null;
  name: string | null;
  email: string | null;
  /** From Dentally (the matched patient's earliest treatment-plan invoice
   *  line), NEVER GoHighLevel's own free-text lead.treatment field — that
   *  field is unreliable on live data (often the opportunity's own name,
   *  not a treatment). null until a treatment-plan invoice exists. */
  treatment: string | null;
  booked: boolean;
  /** True once `paidPence` EXCEEDS the payload's acceptanceMinPaidPence —
   *  money paid, not an invoice marked paid. */
  accepted: boolean;
  /** Settled payments attributable to this lead, in pence, NET OF REFUNDS:
   *  every settled row from the lead's own day onward, signed and summed.
   *
   *  TO DATE, NOT WITHIN THE WINDOW. Acceptance is a cohort question — of
   *  the leads this period's spend bought, how many have paid — so money
   *  counts whenever it arrives, exactly as `booked` counts an appointment
   *  whenever it happens. A lead from 12 July who paid on 15 August shows
   *  that £173 on the July report. Window-bounding it undercounted July by
   *  25% of its booked leads.
   *
   *  0 is a real answer (paid nothing, or paid and fully refunded), not a
   *  missing one, and the value can be NEGATIVE when refunds exceed
   *  payments since the lead landed. */
  paidPence: number;
  /** false only means "not new" for a phone that actually matched a
   *  Dentally patient — an unmatched lead is also false here, but that is
   *  moot: booked/accepted are false for it either way. */
  isNewPatient: boolean;
  /** null means "could not be tied to a campaign" — a real answer, shown as
   *  such rather than left as a blank cell that reads as a rendering fault. */
  campaignId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  keywordId: string | null;
  keywordText: string | null;
  /** Which route resolved the campaign above. null when none did. */
  attribution: 'callrail_keyword' | 'callrail_campaign' | 'ghl_campaign' | null;
}

export interface GoogleLeadPerformancePayload {
  state: GoogleState;
  /** One row per practice with spend or leads in the window; omitted
   *  (`?practice_id=` unset) is the default and returns every practice. */
  practices: GoogleLeadPractice[];
  /** Same shape as a practice row, summed across every practice in scope —
   *  the all-practices total the cards show by default. null when there is
   *  no data at all (state !== 'ok'). New patients only (see isNewPatient on
   *  GoogleLeadRow) — the owner's own CPB/CPA definition. */
  total: GoogleLeadPractice | null;
  /** Same shape as `practices`, but booked/accepted count EVERY match
   *  regardless of isNewPatient — the owner-requested "include existing
   *  patients" toggle reads this instead of `practices`, entirely
   *  client-side: both are computed from the SAME fetch, so flipping the
   *  toggle costs no extra request. */
  practicesAll: GoogleLeadPractice[];
  /** `practicesAll` summed — the toggle's "including existing" total. */
  totalAll: GoogleLeadPractice | null;
  /** Every deduplicated lead behind `total`/`practices` (and
   *  `totalAll`/`practicesAll`) — filter client-side by `booked`/`accepted`
   *  (and `isNewPatient`, matching whichever total is on screen) for a
   *  card's click-through list. */
  leads: GoogleLeadRow[];
  /** Per-campaign cost per lead / booking / accepted patient, new patients
   *  only. Always present — `[]` rather than absent on the not-connected and
   *  empty-window shapes, so the page reads the key unconditionally. */
  campaigns: GoogleCampaignPerformance[];
  /** The same, counting existing patients too — the toggle's other half,
   *  computed from the SAME fetch so flipping it costs no request. */
  campaignsAll: GoogleCampaignPerformance[];
  attribution: GoogleAttributionCoverage;
  /** False when this org has not mapped ANY GoHighLevel pipeline to the
   *  google_ads channel (Settings -> Ad attribution) — a leads figure of 0
   *  then means "not configured", not "quiet period", and the cards must say
   *  so rather than showing a silent zero. */
  googlePipelinesMapped: boolean;
  /** The acceptance floor `accepted` was computed against, in pence (£40 =
   *  4000 today). Sent by the server so the card's label states the REAL
   *  threshold — a hardcoded copy here would keep saying "£40" the day the
   *  server's own figure changes. */
  acceptanceMinPaidPence: number;
  effectiveSince: string;
  /** Always false here — leads/calls/appointments/invoices carry no 92-day
   *  deep-grain cap the way the campaign/ad-group/ad/keyword tiers do. */
  windowClamped: boolean;
}

export function fetchGoogleLeadPerformance(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleLeadPerformancePayload>(`/api/marketing/google/lead-performance${suffix}`);
}

export function fetchGoogleCampaigns(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleCampaignsPayload>(`/api/marketing/google/campaigns${suffix}`);
}

// campaignId (?campaignId=) is OPTIONAL — the Ad groups tab calls this with
// no filter at all to list every ad group in the window across every
// campaign. Matches backend/src/routes/marketing.routes.js's '/google/ad-groups'.
export function fetchGoogleAdGroups(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleAdGroupsPayload>(`/api/marketing/google/ad-groups${suffix}`);
}

// parentId (?parentId=, an AD GROUP id) is OPTIONAL, so the Ads tab can list
// every ad in the window unfiltered. Matches '/google/ads'.
export function fetchGoogleAds(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleAdsPage>(`/api/marketing/google/ads${suffix}`);
}

// Same shape and same parentId filter as ads — keywords are the SIBLING of
// ads under an ad group, not nested beneath them. Matches '/google/keywords'.
export function fetchGoogleKeywords(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleKeywordsPage>(`/api/marketing/google/keywords${suffix}`);
}

// Search terms — the fifth grain, and the only one with a window of its own.
// Same optional campaignId/parentId filters as the ad and keyword tiers.
export function fetchGoogleSearchTerms(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<GoogleSearchTermsPage>(`/api/marketing/google/search-terms${suffix}`);
}
