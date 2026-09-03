// Facebook report API client. NOTE the /api prefix: the Next proxy forwards
// the path verbatim, so omitting it 404s SILENTLY into an empty state.
//
// No organisation id is ever sent. The backend takes it from the session,
// which under an agency switch is already the sub-account — sending one would
// be a cross-tenant request.
//
// This page sits under the shared scope bar, whose period pills must move
// these numbers, so the fetchers here take a pre-built query string (`qs`)
// rather than individual arguments — mirroring fetchMarketingPerformance(qs)
// in ../api.ts. The hooks in ./hooks.ts build that string; see the long
// comment there for why it CANNOT be the shared windowParams(scope, win)
// every sibling marketing hook uses. Short version: FacebookQuerySchema
// (backend/src/controllers/marketing.controller.js) requires plain
// `YYYY-MM-DD`, both ends INCLUSIVE — not windowParams' ISO-datetime,
// half-open [since, until) — because campaignSpendByProvider() compares
// against a plain DATE column with `.gte(...).lte(...)`. `practice_id` is
// sent the same way `/leads` sends it; anything that isn't a UUID is treated
// as unscoped server-side (`practiceOf` in marketing.controller.js).
import { api } from '@/lib/api';

export type FacebookState = 'not_connected' | 'never_synced' | 'no_ad_id_coverage' | 'ok';

export interface FacebookCoverage {
  leadsTotal: number;
  leadsWithAdSet: number;
  /** This organisation's own coverage, not a global assumption. Percent, 0-100. */
  pct: number;
}

export interface FacebookRow {
  /**
   * null only on the `totals` row (campaigns()'s aggregate row carries
   * id/name/status all null) — every per-campaign/ad-set/ad row has a real id.
   */
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
  leads: number;
  booked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  patients: number;
  newPatients: number;
  /** null when the denominator (leads) is zero. A cost per nothing is unknowable, not free. */
  cplPence: number | null;
  /** null when the denominator (booked) is zero. */
  cpbPence: number | null;
  /** null when the denominator (patients) is zero. */
  cpaPence: number | null;
}

export interface FacebookAdSetRow extends FacebookRow {
  /** Unique people. NEVER additive — do not sum this column. Ad-set tier only. */
  reach: number | null;
}

export interface FacebookFunnelTotals {
  leads: number;
  booked: number;
  attended: number;
  patients: number;
  newPatients: number;
}

export interface FacebookCampaignsPayload {
  state: FacebookState;
  coverage: FacebookCoverage | null;
  rows: FacebookRow[];
  excludedAccounts: Array<{
    customerId: string;
    name: string | null;
    /** Currently always 'unsupported_currency'. */
    reason: string;
    currency: string | null;
  }>;
  /** Same shape as a row's, with id/name/status null. null when rows is empty. */
  totals: FacebookRow | null;
  /**
   * Summed funnel for leads whose campaign has NO spend in this window — real
   * Meta leads that coverage/totals/rows deliberately exclude, because folding
   * them in would inflate lead counts while contributing nothing to spend and
   * silently understate every cost figure. null when there are none.
   */
  unmatchedLeads: FacebookFunnelTotals | null;
  /** The window actually used. The deep-grain tables keep 92 days, so a
   *  longer request is clamped to what the finest grain can cover. */
  effectiveSince: string;
  /** True when the requested window started before that 92-day floor, so the
   *  page can say what it is showing instead of quietly showing something
   *  other than what was asked for. */
  windowClamped: boolean;
}

export interface FacebookAdSetsPayload {
  state: FacebookState;
  coverage: FacebookCoverage | null;
  rows: FacebookAdSetRow[];
  /** Leads attributed to this campaign whose ad set could not be resolved. null when coverage is complete. */
  notIdentified: FacebookFunnelTotals | null;
  /** The window actually used. The deep-grain tables keep 92 days, so a
   *  longer request is clamped to what the finest grain can cover. */
  effectiveSince: string;
  /** True when the requested window started before that 92-day floor, so the
   *  page can say what it is showing instead of quietly showing something
   *  other than what was asked for. */
  windowClamped: boolean;
}

export interface FacebookAdsPage {
  /** Same shape as the campaign tier's rows — no reach at this tier. */
  rows: FacebookRow[];
  /** Opaque; pass back verbatim as `cursor`. null on the last page. */
  nextCursor: string | null;
  /** The window actually used. The deep-grain tables keep 92 days, so a
   *  longer request is clamped to what the finest grain can cover. */
  effectiveSince: string;
  /** True when the requested window started before that 92-day floor, so the
   *  page can say what it is showing instead of quietly showing something
   *  other than what was asked for. */
  windowClamped: boolean;
}

export function fetchFacebookCampaigns(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookCampaignsPayload>(`/api/marketing/facebook/campaigns${suffix}`);
}

export function fetchFacebookAdSets(campaignId: string, qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookAdSetsPayload>(
    `/api/marketing/facebook/campaigns/${encodeURIComponent(campaignId)}/adsets${suffix}`,
  );
}

export function fetchFacebookAds(adSetId: string, qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookAdsPage>(`/api/marketing/facebook/adsets/${encodeURIComponent(adSetId)}/ads${suffix}`);
}
