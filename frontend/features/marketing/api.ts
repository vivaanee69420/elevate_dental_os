// Marketing API client. NOTE the /api prefix: the Next proxy forwards the path
// verbatim, so omitting it 404s SILENTLY into an empty state.
import { api } from '@/lib/api';

export type Tier = 'campaign' | 'channel' | 'unattributed';

export interface CampaignRow {
  provider: 'google_ads' | 'meta_ads';
  campaignId: string;
  campaignName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  /** Held a GoHighLevel calendar slot or a Dentally appointment after enquiring. */
  booked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  patients: number;
  newPatients: number;
  costPerLeadPence: number | null;
  costPerBookingPence: number | null;
  costPerPatientPence: number | null;
  costPerNewPatientPence: number | null;
  tier: Tier;
}

export interface MarketingTotals {
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  /** Everyone who enquired in the window — organic and unattributed included. */
  leads: number;
  /** Only the people matched to a campaign with spend: the cost denominator. */
  attributedLeads: number;
  /** Held a GoHighLevel calendar slot or a Dentally appointment after enquiring. */
  booked: number;
  /** Of the booked, matched to a campaign with spend: the cost-per-booking denominator. */
  attributedBooked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  /** Everyone in the lead population who became a patient. */
  patients: number;
  /** Patients whose campaign we hold spend for: the cost-per-patient denominator. */
  attributedPatients: number;
  /** Of those patients, the ones with no appointment before this window. */
  newPatients: number;
  /** New patients whose campaign we hold spend for: the cost-per-new-patient denominator. */
  attributedNewPatients: number;
  unattributedLeads: number;
  costPerLeadPence: number | null;
  costPerBookingPence: number | null;
  costPerPatientPence: number | null;
  costPerNewPatientPence: number | null;
}

export type Channel = 'google_ads' | 'meta_ads' | 'other';

/**
 * One channel's own figures. Built LEADS-FIRST, not by rolling up the campaign
 * table: a channel appears whenever it has leads OR spend, so a practice whose
 * Google account spent nothing this month still sees its Google leads instead
 * of having them silently folded into a single blended number.
 *
 * Every lead lands in exactly one channel, so `leads` across the rows sums to
 * the lead total. `other` is organic social, referral, direct and untracked
 * traffic — it carries leads and patients but never a cost.
 */
export interface ChannelRow {
  channel: Channel;
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  /** Held a GoHighLevel calendar slot or a Dentally appointment after enquiring. */
  booked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  patients: number;
  campaigns: number;
  costPerLeadPence: number | null;
  costPerBookingPence: number | null;
  costPerPatientPence: number | null;
}

/** One London calendar day of spend, split by channel. */
export interface SpendDay {
  date: string;
  spendPence: number;
  google_ads: number;
  meta_ads: number;
}

/**
 * Why a figure may be missing. Without this the screen cannot tell "this
 * practice spent nothing" apart from "no ad account is mapped to it, so none
 * of the group's spend can be attributed here" — both render as £0.00.
 */
export interface MarketingCoverage {
  totalAccounts: number;
  mappedAccounts: number;
  unmappedAccounts: number;
  unmappedAccountNames: string[];
  /** Spend on accounts with no practice mapping. Group view only. */
  unmappedSpendPence: number;
  /** null when not scoped to a practice. */
  practiceHasMappedAccount: boolean | null;
}

/** One practice's figures, for the comparison screen. */
export interface PracticeRow {
  practiceId: string | null;
  spendPence: number;
  leads: number;
  /** Held a GoHighLevel calendar slot or a Dentally appointment after enquiring. */
  booked: number;
  patients: number;
  newPatients: number;
  channels: Record<Channel, number>;
  costPerLeadPence: number | null;
  costPerNewPatientPence: number | null;
}

export interface MarketingPerformance {
  rows: CampaignRow[];
  totals: MarketingTotals;
  byChannel: ChannelRow[];
  byPractice: PracticeRow[];
  series: SpendDay[];
  coverage: MarketingCoverage;
}

export interface TrendChannel {
  spendPence: number;
  leads: number;
  patients: number;
  newPatients: number;
  costPerLeadPence: number | null;
}

export interface TrendMonth {
  month: string;
  spendPence: number;
  leads: number;
  patients: number;
  newPatients: number;
  channels: Record<Channel, TrendChannel>;
}

export type LeadStage = 'enquired' | 'booked' | 'attended' | 'new_patient';

/**
 * How far a person got. Attendance comes from Dentally only — GoHighLevel has
 * recorded two no-shows in its entire history — so a person who booked through
 * GoHighLevel alone stays at "Booked" rather than being reported as a no-show.
 */
export const STAGE_LABEL: Record<LeadStage, string> = {
  enquired: 'Enquired',
  booked: 'Booked',
  attended: 'Attended',
  new_patient: 'New patient',
};

export interface MarketingLead {
  contactId: string;
  practiceId: string | null;
  channel: Channel;
  campaignId: string | null;
  campaignName: string | null;
  attributionSource: string | null;
  /** GoHighLevel pipeline the person first came in on, e.g. '6. Chatbot Website'. */
  pipelineId: string | null;
  /** Null when the id matches no synced pipeline definition (archived or deleted). */
  pipelineName: string | null;
  enquiredAt: string | null;
  bookedAt: string | null;
  converted: boolean;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: boolean;
  isNewPatient: boolean;
  matchedBy: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** How far this person got. See STAGE_LABEL for the no-show caveat. */
  stage: LeadStage;
}

export interface MarketingLeadPage {
  total: number;
  page: number;
  size: number;
  rows: MarketingLead[];
}

export const EMPTY_PERFORMANCE: MarketingPerformance = {
  rows: [],
  totals: {
    spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
    leads: 0, attributedLeads: 0, booked: 0, attended: 0, attributedBooked: 0,
    patients: 0, attributedPatients: 0, newPatients: 0, attributedNewPatients: 0,
    unattributedLeads: 0,
    costPerLeadPence: null, costPerBookingPence: null,
    costPerPatientPence: null, costPerNewPatientPence: null,
  },
  byChannel: [],
  byPractice: [],
  series: [],
  coverage: {
    totalAccounts: 0, mappedAccounts: 0, unmappedAccounts: 0,
    unmappedAccountNames: [], unmappedSpendPence: 0, practiceHasMappedAccount: null,
  },
};

export const CHANNEL_LABEL: Record<string, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  other: 'Other sources',
};

/**
 * Channel identity, fixed. Teal = Google, blue = Facebook, on every screen —
 * colour follows the entity, never its rank, so a filter that drops one
 * channel never repaints the other. Validated for colour-vision deficiency
 * against a white chart surface (deutan dE 22.2, tritan 11.2, normal 25.0).
 */
export const CHANNEL_COLOUR: Record<string, string> = {
  google_ads: '#0d9488',
  meta_ads: '#1d4ed8',
  // Deliberately a neutral, not a third hue: "other" is the absence of a paid
  // channel, and giving it a colour of its own would let it read as one.
  other: '#9ca3af',
};

/**
 * One grain's spend measured against the campaign-level total for the same
 * window (ad group/ad/keyword for Google, ad set/ad for Meta — the "ads deep
 * grain pull"). `gapPence` is zeroed under a rounding tolerance server-side;
 * `gapPct` is `null`, never `0`, when there is no campaign spend to divide
 * by — a percentage of nothing is unknowable, not zero. `note` explains an
 * EXPECTED shortfall (Google keywords) in calm terms, or flags a genuine
 * mismatch — see docs/API.md "Marketing reconciliation".
 */
export interface ReconciliationLevel {
  grain: string;
  label: string;
  spendPence: number;
  campaignSpendPence: number;
  gapPence: number;
  gapPct: number | null;
  additive: boolean;
  note: string | null;
}

/**
 * An ad account left out of BOTH sides of the comparison, and why. Not an
 * error — an excluded account is a fact to state calmly. `reason` is one of
 * `not_selected` | `unsupported_currency` | a platform status the nightly sync
 * skips on (`manager`, `not_enabled`); `description` is the server's own
 * ready-made prose for it, so the panel never has to re-derive the wording.
 */
export interface ExcludedAdAccount {
  customerId: string;
  name: string | null;
  reason: string;
  currency: string | null;
  description: string;
}

export interface Reconciliation {
  provider: 'google_ads' | 'meta_ads';
  since: string;
  until: string;
  campaignSpendPence: number;
  levels: ReconciliationLevel[];
  /** Meta only: reach is unique people, never additive across ad sets. */
  reachNote: string | null;
  /** False when the totals cover only some of the connected accounts. */
  coversAllAccounts: boolean;
  coveredAccountCount: number;
  excludedAccounts: ExcludedAdAccount[];
  /** Set only when `excludedAccounts` is non-empty; states the partial cover. */
  excludedNote: string | null;
}

export async function fetchMarketingPerformance(qs: string): Promise<MarketingPerformance> {
  return api(`/api/marketing/performance?${qs}`);
}

export async function fetchMarketingTrend(qs: string): Promise<{ months: TrendMonth[] }> {
  return api(`/api/marketing/trend?${qs}`);
}

export async function fetchMarketingLeads(qs: string): Promise<MarketingLeadPage> {
  return api(`/api/marketing/leads?${qs}`);
}

/**
 * No window is sent, deliberately.
 *
 * The endpoint accepts optional plain YYYY-MM-DD bounds, but the window this
 * panel wants is exactly the deep pull's own — `londonDaysAgo(92)` to today in
 * LONDON — and only the server can compute that on the same clock the sync
 * uses. Deriving it here from `Date.now()` in UTC put the two an hour apart
 * for the whole of BST between 00:00 and 01:00 London, so the panel asked for
 * a day that existed in `ad_metrics` but could not yet exist in the deep
 * tables: a full day of campaign spend on one side of the comparison only, and
 * both non-keyword levels red. The server fills the window in; the response
 * reports the dates it used.
 */
export async function fetchReconciliation(
  provider: 'google_ads' | 'meta_ads',
): Promise<Reconciliation> {
  const qs = new URLSearchParams({ provider });
  // NOTE the /api prefix: api() only prepends the /api/backend proxy base,
  // not the Express mount point — the Express backend mounts this route
  // under /api, so the path here still has to start with /api/... or the
  // request 404s SILENTLY into an empty state (see file header).
  return api(`/api/marketing/reconciliation?${qs}`);
}
