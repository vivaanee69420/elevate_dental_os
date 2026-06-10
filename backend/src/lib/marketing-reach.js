// Period-deduplicated reach/frequency overlay for ad-spend aggregations.
//
// Reach is the count of UNIQUE people who saw an ad over a window; it is NOT
// additive across days, so summing the per-day ad_metrics rows over-counts it
// (~3x for a 30-day window) and collapses frequency toward 1. Meta only reports
// the true figures when an account is queried for the window without a daily
// breakdown — meta-ads-sync.js stores that per account on ad_accounts
// (period_reach / period_frequency / period_window_start / period_window_end,
// migration 000072). This helper overlays those stored values onto a summed
// aggregate so callers never display the wrong reach.
//
//   - reach: sum of each contributing account's period_reach. Meta cannot
//     deduplicate audiences ACROSS ad accounts, so summing per-account reach is
//     the best available figure (and matches Meta's own per-account reporting).
//   - frequency: a single account uses Meta's stored period_frequency (exact);
//     multiple accounts recompute impressions / unique-reach over the period.
//   - reach_is_approx: true when any contributing snapshot covers a different
//     window than the one being displayed (the stored window is the last sync
//     window, ~30 days; an arbitrary custom range cannot be rebuilt exactly).
//
// Returns { reach, frequency, reach_is_approx } with reach/frequency null when
// no contributing account reported reach (e.g. Google-only — Google has no
// reach metric).
export function overlayPeriodReach(impressions, snaps, fromDate, toDate) {
    const withReach = (snaps ?? []).filter((s) => s && s.period_reach != null);
    if (withReach.length === 0) {
        return { reach: null, frequency: null, reach_is_approx: false };
    }
    const reach = withReach.reduce((s, x) => s + Number(x.period_reach ?? 0), 0);
    const frequency = withReach.length === 1 && withReach[0].period_frequency != null
        ? Number(withReach[0].period_frequency)
        : (reach > 0 ? +((Number(impressions ?? 0)) / reach).toFixed(2) : null);
    const reach_is_approx = withReach.some(
        (s) => s.period_window_start !== fromDate || s.period_window_end !== toDate,
    );
    return { reach, frequency, reach_is_approx };
}
