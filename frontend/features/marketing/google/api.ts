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
