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

export type FacebookState =
  | 'not_connected'
  | 'never_synced'
  // The campaign tier (ad_metrics) has real totals for this org, but THIS
  // grain's own deep table (ad_meta_adsets/ad_meta_ads) has never received a
  // row — the deep sync has not run yet, distinct from no_spend_in_window
  // (both tables have synced before, just nothing in this window/filter).
  // Never returned by campaigns(), whose own table already IS ad_metrics.
  // See facebook-report.service.js's emptyWindowState.
  | 'detail_not_synced'
  | 'no_spend_in_window'
  | 'no_ad_id_coverage'
  | 'ok';

/**
 * What the state/coverage figures on a payload were actually measured over.
 * The campaign tier measures the whole organisation (or, under a practice
 * filter, that selection); the ad-set tier measures ONE campaign; the ad
 * tier measures ONE ad set when filtered. Saying "this organisation" over a
 * per-campaign (or per-ad-set) computation tells an org with 90% coverage
 * that its whole CRM sends no ad ids.
 */
export type FacebookNoticeScope = 'organisation' | 'selection' | 'campaign' | 'adset';

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
  /** Same shape as the campaign tier — there is no `reach` column: ad_grain_rollup does not return it. */
  rows: FacebookRow[];
  /** Leads attributed to this campaign whose ad set could not be resolved at all. null when there are none. */
  notIdentified: FacebookFunnelTotals | null;
  /**
   * Leads whose ad set DID resolve but which is not among `rows` — no delivery
   * in this window, or its spend sits under a different practice mapping.
   * Without this bucket those leads appeared in no row and in no bucket, so
   * the ad-set tier could sum to less than the campaign row above it. null
   * when there are none.
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

export interface FacebookAdsPage {
  /**
   * This grain's OWN state — computed from the deep-grain ad rollup and
   * ad_id resolution, not borrowed from campaigns(). A tenant can be `ok` at
   * the campaign tier while the ad-level sync has nothing for this window,
   * or vice versa; each tier reports what it actually found.
   */
  state: FacebookState;
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

// Flat, query-filtered endpoint — campaignId narrows it (?campaignId=) but is
// OPTIONAL: the Ad sets tab calls this with no filter at all to list every ad
// set in the window across every campaign. Matches
// backend/src/routes/marketing.routes.js's '/facebook/ad-sets'.
export function fetchFacebookAdSets(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookAdSetsPayload>(`/api/marketing/facebook/ad-sets${suffix}`);
}

// Same shape: adSetId (?adSetId=) is OPTIONAL, so the Ads tab can list every
// ad in the window unfiltered. Matches '/facebook/ads'.
export function fetchFacebookAds(qs: string) {
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookAdsPage>(`/api/marketing/facebook/ads${suffix}`);
}


// ---------------------------------------------------------------------------
// Blended CPL / CPB / CPA (migration 000167).
//
// `accepted` here is the SAME rule the Google report uses — settled payments
// attributable to the lead, net of refunds, from the lead's own London day
// onward, above acceptanceMinPaidPence. It is deliberately NOT the campaign
// tab's `patients`, which counts a lead that resolved to any Dentally record
// whether or not money ever changed hands.
// ---------------------------------------------------------------------------
export interface FacebookLeadPractice {
  practiceId: string | null;
  practiceName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  leads: number;
  booked: number;
  accepted: number;
  /** null, never 0: a cost per nothing is unknowable, not free. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
}

export interface FacebookLeadCampaign extends Omit<FacebookLeadPractice, 'practiceId' | 'practiceName'> {
  campaignId: string | null;
  campaignName: string | null;
  channelType: string | null;
  /** false for the "not attributed" bucket, which owns no spend of its own. */
  attributed: boolean;
  conversions: number;
  paidPence: number;
  returnOnSpend: number | null;
  ctr: number | null;
}

export interface FacebookLeadRow {
  contact_id: string | null;
  practice_id: string | null;
  practice_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_set_id: string | null;
  ad_id: string | null;
  lead_at: string | null;
  name: string | null;
  email: string | null;
  treatment: string | null;
  booked: boolean;
  accepted: boolean;
  is_new_patient: boolean;
  paid_pence: number;
}

// ---------------------------------------------------------------------------
// Open days (migration 000168). A named event, and the campaigns that promoted
// it. Always-on is simply "not mapped to an event", which is why the two
// buckets provably cover every campaign exactly once.
// ---------------------------------------------------------------------------
export interface FacebookOpenDayBucket {
  spendPence: number;
  impressions: number;
  clicks: number;
  conversions: number;
  leads: number;
  booked: number;
  accepted: number;
  paidPence: number;
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
}

export interface FacebookOpenDayEvent extends FacebookOpenDayBucket {
  openDayId: string;
  name: string | null;
  eventDate: string | null;
  /** Campaigns of this event that ran in the SELECTED window, not all mapped. */
  campaigns: number;
  /** Practices that ran it, from the ad account each campaign belongs to. */
  practices: number;
}

export interface FacebookOpenDaySplit {
  alwaysOn: FacebookOpenDayBucket;
  openDays: FacebookOpenDayBucket;
  events: FacebookOpenDayEvent[];
}

export interface FacebookLeadPerformancePayload {
  state: FacebookState;
  practices: FacebookLeadPractice[];
  total: FacebookLeadPractice | null;
  /** The same figures counting existing patients too — one fetch, both views. */
  practicesAll: FacebookLeadPractice[];
  totalAll: FacebookLeadPractice | null;
  campaigns: FacebookLeadCampaign[];
  campaignsAll: FacebookLeadCampaign[];
  /** alwaysOn + openDays === the totals above, metric for metric. */
  openDays: FacebookOpenDaySplit;
  openDaysAll: FacebookOpenDaySplit;
  leads: FacebookLeadRow[];
  excludedAccounts: unknown[];
  /** The acceptance floor the SERVER used. Never re-stated as a literal here. */
  acceptanceMinPaidPence: number;
  effectiveSince: string;
  windowClamped: boolean;
}

export function fetchFacebookLeadPerformance(qs: string) {
  // ymdWindowParams returns `since=..&until=..` with NO leading '?', so the
  // separator belongs here — same as every fetcher above. Interpolating qs
  // raw produced `/lead-performancesince=2026-09-01`, which 404s SILENTLY:
  // React Query errors, data is undefined, and the panel rendered nothing at
  // all rather than an error. That is how this shipped unnoticed.
  const suffix = qs ? `?${qs}` : '';
  return api<FacebookLeadPerformancePayload>(`/api/marketing/facebook/lead-performance${suffix}`);
}


// --- open-day management ----------------------------------------------------
export interface OpenDayRecord {
  id: string;
  name: string;
  eventDate: string | null;
  campaignIds: string[];
}

export interface OpenDayCampaignOption {
  campaignId: string;
  campaignName: string | null;
  customerId: string | null;
  accountName: string | null;
  firstDay: string | null;
  lastDay: string | null;
  spendPence: number;
}

export interface OpenDayManagePayload {
  openDays: OpenDayRecord[];
  /** Every Meta campaign the org has metrics for — not just this window's. */
  campaigns: OpenDayCampaignOption[];
  /** campaignId -> the event it already belongs to, so a move is visible. */
  assignedTo: Record<string, string>;
  /** `${accountId}|${pipelineId}` -> open day id. */
  pipelineAssignedTo: Record<string, string>;
}

export function fetchOpenDays() {
  return api<OpenDayManagePayload>('/api/marketing/facebook/open-days');
}

export function createOpenDay(body: { name: string; eventDate: string | null }) {
  return api<{ id: string }>('/api/marketing/facebook/open-days', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function updateOpenDay(id: string, body: { name?: string; eventDate?: string | null }) {
  return api(`/api/marketing/facebook/open-days/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export function deleteOpenDay(id: string) {
  return api(`/api/marketing/facebook/open-days/${id}`, { method: 'DELETE' });
}

export function setOpenDayCampaigns(
  id: string,
  campaigns: { campaign_id: string; customer_id: string | null }[],
) {
  return api(`/api/marketing/facebook/open-days/${id}/campaigns`, {
    method: 'PUT', body: JSON.stringify({ campaigns }),
  });
}
