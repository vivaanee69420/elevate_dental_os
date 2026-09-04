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

// Keyword rows additionally carry match type, Quality Score and the three
// impression-share ratios (0-1, or null). See APPROXIMATE below for what
// "approximate" means for the last four of these.
export interface GoogleKeywordRow extends GoogleRow {
  matchType: string | null;
  /** 1-10, the LATEST value in the window — not an average. null if unknown. */
  qualityScore: number | null;
  searchImpressionShare: number | null;
  searchTopImpressionShare: number | null;
  searchAbsoluteTopImpressionShare: number | null;
}

/** The two approximation statements keywords() always carries. Fixed text,
 *  not computed per request — see google-report.service.js's APPROXIMATE. */
export interface GoogleApproximate {
  impressionShare: string;
  qualityScore: string;
}

export interface GoogleCampaignsPayload {
  state: GoogleState;
  rows: GoogleRow[];
  excludedAccounts: GoogleExcludedAccount[];
  /** Same shape as a row's, with id/name/status null. null when rows is empty. */
  totals: GoogleRow | null;
  /** The window actually used. The deep-grain tables keep 92 days, so a
   *  longer request is clamped to what the finest grain can cover. */
  effectiveSince: string;
  /** True when the requested window started before that 92-day floor. */
  windowClamped: boolean;
}

export interface GoogleAdGroupsPayload {
  state: GoogleState;
  /** No totals at this tier — matches the Facebook ad-set tier. */
  rows: GoogleRow[];
  excludedAccounts: GoogleExcludedAccount[];
  effectiveSince: string;
  windowClamped: boolean;
}

export interface GoogleAdsPage {
  state: GoogleState;
  rows: GoogleRow[];
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
   *  from the lead's own day onward, net of refunds, EXCEED the payload's
   *  acceptanceMinPaidPence (£40). Not "has a paid invoice": a floor is what
   *  separates committing to treatment from paying for the appointment. */
  accepted: number;
  /** null when the corresponding denominator (leads/booked/accepted) is
   *  zero. A cost per nothing is unknowable, not free. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
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
   *  every settled row from the lead's own day onward within the window,
   *  signed and summed. 0 is a real answer (paid nothing, or paid and fully
   *  refunded), not a missing one — and the value can be NEGATIVE when a
   *  refund lands in the window for something paid before the lead. */
  paidPence: number;
  /** false only means "not new" for a phone that actually matched a
   *  Dentally patient — an unmatched lead is also false here, but that is
   *  moot: booked/accepted are false for it either way. */
  isNewPatient: boolean;
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
