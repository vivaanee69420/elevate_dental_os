'use client';
// ============================================================================
// Says how much of the window's spend is final.
//
// Ad spend arrives from a nightly sync, so the CURRENT day only holds what had
// been spent by the moment it ran. On 6 September 2026 the sync last wrote at
// 03:50, so the day carried £68 against a ~£720 daily average — and this page
// rendered it as a finished total. Checked against Meta Ads Manager by hand,
// every campaign was 13-18% short, and impressions were short by the same
// fraction, because whole hours were missing rather than any figure being
// computed wrongly.
//
// A total that looks right and is not is the worst thing this page can do, so
// the incomplete day is stated rather than quietly included.
// ============================================================================

export interface SpendFreshness {
  /** ISO instant ad_metrics was last written for this provider. */
  syncedAt: string | null;
  /** Last day whose figures are final (YYYY-MM-DD). */
  completeTo: string | null;
  /** The window runs past completeTo, so what is shown understates. */
  partial: boolean;
}

function longDay(ymd: string) {
  // Parsed at midday so a BST/GMT shift can never roll the date backwards.
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long',
  });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
}

export default function SpendFreshnessNote({ freshness }: { freshness?: SpendFreshness | null }) {
  // Nothing known is not the same as nothing wrong: if the read failed the
  // fields come back null, and claiming the window is complete would be the
  // very thing this component exists to prevent.
  if (!freshness) return null;
  if (!freshness.partial || !freshness.completeTo) return null;

  return (
    <p className="mt-2 text-[12.5px] text-ink-2">
      Spend and impressions are final to <strong>{longDay(freshness.completeTo)}</strong>.
      Later days are still being collected
      {freshness.syncedAt ? ` — last synced ${time(freshness.syncedAt)}` : ''}, so the
      figures below understate the most recent day. Refresh the ad account on
      Integrations to pull it now.
    </p>
  );
}
