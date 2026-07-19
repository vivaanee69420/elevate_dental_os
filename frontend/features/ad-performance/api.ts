import { api } from '@/lib/api';

// Matches ad_metrics.provider / ad_channel_pipelines.channel — 'unassigned' is
// its own bucket (a pipeline with no explicit mapping), never guessed at.
export type PerfChannel = 'google_ads' | 'meta_ads' | 'unassigned';

// One row per channel. Null money/rate fields mean "not known", not zero:
// - spendPence is null for 'unassigned' (no spend feed maps there at all) and
//   for any channel whose spend feed hasn't reported for this window.
// - costPerLeadPence / costPerAcquisitionPence are null whenever spendPence is
//   null, OR when the OTHER paid channel's spend hasn't reported yet (dividing
//   known spend against an incomplete population understates cost).
// - conversionRate is null only when there are no leads at all (0/0).
// See backend/src/services/ad-attribution.service.js `finalise()`.
export interface ChannelStats {
  channel: PerfChannel;
  leads: number;
  conversions: number;
  acceptedValuePence: number;
  spendPence: number | null;
  costPerLeadPence: number | null;
  costPerAcquisitionPence: number | null;
  conversionRate: number | null;
}

// The group- or practice-level total, DEDUPED PER PERSON ACROSS ALL CHANNELS
// (including 'unassigned'). Do not compute this by summing the `channels`
// array — a person who enquired via both a Google-tagged and a
// Facebook-tagged pipeline is counted once under EACH channel (correct for
// comparing channels), so a naive sum inflates leads/revenue. This is the
// deduped figure that prevents that. `paidLeads`/`paidConversions` are the
// narrower population (google_ads + meta_ads only, deduped) that the cost
// metrics on this same object divide by — NOT `leads`/`conversions`.
// See backend `totalsFromStats()`.
export interface AdTotals {
  channel: 'total';
  leads: number;
  conversions: number;
  acceptedValuePence: number;
  spendPence: number | null;
  costPerLeadPence: number | null;
  costPerAcquisitionPence: number | null;
  conversionRate: number | null;
  paidLeads: number;
  paidConversions: number;
}

export interface PracticeChannels {
  practiceId: string;
  practiceName: string | null;
  channels: ChannelStats[];
  total: AdTotals;
  /**
   * Per-practice monthly trend. The backend has always sent this
   * (`ad-attribution.service.js` byPractice), it was simply not declared here
   * and so was discarded. Same non-additive caveat as the group `trend`:
   * points dedupe per person PER MONTH, so they do not sum to the scorecard.
   */
  trend: TrendMonth[];
}

export interface TrendMonth {
  month: string;            // 'YYYY-MM'
  channels: ChannelStats[]; // google_ads and meta_ads only
}

export interface AdPerformance {
  channels: ChannelStats[];
  totals: AdTotals;
  byPractice: PracticeChannels[];
  trend: TrendMonth[];
  /** Leads on a GHL subaccount with no practice mapped — deliberately excluded. */
  excludedUnmappedLeads: number;
  unmappedPipelineCount: number;
}

export interface AdLeadLine {
  id: string;
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  channel: PerfChannel;
  pipelineName: string | null;
  createdAt: string;
  converted: boolean;
  matchedTreatmentName: string | null;
  matchedValuePence: number;
}

export interface AdPerfParams {
  since: string;
  until: string;
  practiceId?: string;
}

export function fetchAdPerformance(p: AdPerfParams) {
  const sp = new URLSearchParams({ since: p.since, until: p.until });
  if (p.practiceId) sp.set('practice_id', p.practiceId);
  return api<AdPerformance>(`/api/ad-attribution/performance?${sp.toString()}`);
}

// The drill-down panels on the Ad Performance page are computed CLIENT-side
// from this list, so the request limit must be high enough that it does not
// bind in practice. The backend zod schema (backend/src/models/ad-attribution.model.js)
// has no maximum, so raising this is a frontend-only change.
export const LEAD_FETCH_LIMIT = 5000;

export function fetchAdLeads(p: AdPerfParams & { channel?: PerfChannel; limit?: number }) {
  const sp = new URLSearchParams({ since: p.since, until: p.until });
  if (p.practiceId) sp.set('practice_id', p.practiceId);
  if (p.channel) sp.set('channel', p.channel);
  sp.set('limit', String(p.limit ?? LEAD_FETCH_LIMIT));
  return api<{ leads: AdLeadLine[] }>(`/api/ad-attribution/leads?${sp.toString()}`);
}
