// ============================================================================
// The Business Hub's Marketing figures, as ONE function of its inputs.
//
// It exists to be called TWICE — once for the selected window, once for the
// comparison window — so the prior figure on every card is arrived at by the
// identical arithmetic as the figure above it. Nine ratios computed inline in
// the screen and nine more computed beside them for the previous period would
// be eighteen expressions free to drift, and a comparison whose two sides are
// computed differently is worse than no comparison: it renders a confident
// percentage between two things that were never the same measurement.
//
// Pure: no React, no fetching, no formatting. Every ratio returns null rather
// than 0 where its denominator is missing — a cost per nothing, a rate with no
// leads behind it and a genuine zero say three different things, and only one
// of them is "0".
// ============================================================================

/** What the marketing ROI feed contributes, for one window. */
export interface RoiSide {
  connected: boolean;
  /** The per-lead ad funnel — present only when ad attribution resolved. */
  adFunnel: { leads: number; booked: number; newPatients: number; paidPence: number } | null;
  paidSpendPence: number;
  totalLeads: number;
  /** Platform-reported conversions summed across the feed's own channels. */
  channelAdConversions: number;
}

/** What the business-hub feed contributes, for the same window. */
export interface HubSide {
  /** CRM enquiries. */
  leads: number;
  /** Google + Meta platform-reported conversions. */
  adPlatformConversions: number;
  /** treatment_plans funnel — group-wide, no practice attribution. */
  treatmentsStarted: number;
  /** Invoiced plan fees, already narrowed to the ad filter's practices. */
  closedPence: number;
  /** Dentally registrations, already narrowed to the ad filter's practices. */
  newPatients: number;
}

export interface MarketingKpis {
  leads: number;
  adPlatformConversions: number;
  /** Leads → new patients, %. Null with no leads. */
  conversionPct: number | null;
  /** Null when no ad account is connected — not £0, which reads as "spent nothing". */
  spendPence: number | null;
  /** Money traced to these leads. */
  attributedPence: number;
  /** Attributed money ÷ the spend that bought it. Null without a funnel or spend. */
  roas: number | null;
  revPerLeadPence: number | null;
  leadToStartRatePct: number | null;
  costPerStartPence: number | null;
}

const rateOrNull = (n: number, d: number): number | null =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : null;

export function marketingKpis(roi: RoiSide | null, hub: HubSide, adFilterOn: boolean): MarketingKpis {
  const fun = roi?.adFunnel ?? null;
  const connected = !!roi?.connected;
  const spendPence = connected ? (roi?.paidSpendPence ?? 0) : null;

  // Leads as the ad-account filter sees them — the denominator every ratio
  // below divides by, so its numerator must be scoped to match.
  const leads = fun ? fun.leads : (adFilterOn ? (roi?.totalLeads ?? 0) : hub.leads);
  // Money EARNED FROM THOSE LEADS, not the group's plan fees.
  const attributedPence = fun ? fun.paidPence : hub.closedPence;
  const newPatients = fun ? fun.newPatients : hub.newPatients;

  return {
    leads,
    // With a filter on, the ROI feed is the only side that honours it; without
    // one, the hub's own figure is the fuller count. Same rule both windows.
    adPlatformConversions: adFilterOn ? (roi?.channelAdConversions ?? 0) : hub.adPlatformConversions,
    conversionPct: rateOrNull(newPatients, leads),
    spendPence,
    attributedPence,
    // ROAS needs BOTH a funnel (money traced to these leads) and spend to
    // divide by. Without the funnel the numerator would be the whole group's
    // plan fees over one account's spend — the shape that once read 32x.
    roas: spendPence != null && spendPence > 0 && fun
      ? Math.round((attributedPence / spendPence) * 100) / 100
      : null,
    revPerLeadPence: leads > 0 ? Math.round(attributedPence / leads) : null,
    leadToStartRatePct: rateOrNull(hub.treatmentsStarted, hub.leads),
    costPerStartPence: spendPence != null && spendPence > 0 && hub.treatmentsStarted > 0
      ? Math.round(spendPence / hub.treatmentsStarted)
      : null,
  };
}
