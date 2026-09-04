'use client';
// Six states, one component (the ad-set tier reuses it). Most tenants sit in
// one of the non-happy states rather than the happy path, so each gets its own
// sentence — a generic empty table would leave an owner unable to tell "not
// connected" from "nothing happened".
//
// THREE of these sentences are about a fact this component cannot see on its
// own, so all three are parameterised rather than guessed:
//
//  - never_synced vs detail_not_synced vs no_spend_in_window. "No performance
//    data has arrived yet" used to fire whenever the WINDOW was empty, which
//    told a tenant who paused their campaigns two months ago — or simply
//    picked a quiet day — that they had never synced. The server distinguishes
//    never_synced from a quiet window by probing outside the window. A THIRD
//    fact hid inside "quiet window" until detail_not_synced existed: this
//    grain's own deep table (ad_meta_adsets/ad_meta_ads) can have NEVER
//    received a row while campaign-grain ad_metrics is fully populated — the
//    deep sync (a separate table, separate sync phase) simply has not run
//    yet. Measured on hosted: £123,441 of Meta spend showing on Campaigns
//    beside "no spend in the selected period" on Ad sets and Ads, the day the
//    deep sync had not run. detail_not_synced is the honest state for that
//    case, distinct from no_spend_in_window (this grain's table HAS synced
//    before, just nothing in this window/filter) — see
//    facebook-report.service.js's emptyWindowState.
//
//  - no_ad_id_coverage's SCOPE. That state is computed over whatever the
//    payload measured: the whole organisation at the campaign tier, ONE
//    campaign at the ad-set tier, and a practice-filtered subset of either
//    when the scope bar is narrowed. Wording it "for this organisation"
//    regardless told an org with 90% coverage, drilling into one campaign,
//    that its whole CRM sends no ad ids.
import type { FacebookState, FacebookCoverage, FacebookNoticeScope } from '../api';

const SCOPE_COPY: Record<FacebookNoticeScope, { title: string; body: string }> = {
  organisation: {
    title: 'Ad set and ad detail is not available for this organisation',
    body: 'None of the leads recorded here carry the Meta ad they came from, so leads cannot be attributed below campaign level. Spend, impressions and clicks are shown in full.',
  },
  selection: {
    title: 'Ad set and ad detail is not available for this selection',
    body: 'None of the leads in the selected period and practice carry the Meta ad they came from, so leads cannot be attributed below campaign level. Spend, impressions and clicks are shown in full.',
  },
  campaign: {
    title: 'Ad set and ad detail is not available for this campaign',
    body: "None of this campaign's leads in the selected period carry the Meta ad they came from, so its leads cannot be attributed below campaign level. Spend, impressions and clicks are shown in full.",
  },
  adset: {
    title: 'Ad detail is not available for this ad set',
    body: "None of this ad set's leads in the selected period carry the Meta ad they came from, so its leads cannot be attributed below ad-set level. Spend, impressions and clicks are shown in full.",
  },
};

const COPY: Record<Exclude<FacebookState, 'ok' | 'no_ad_id_coverage'>, { title: string; body: string }> = {
  not_connected: {
    title: 'Meta Ads is not connected',
    body: 'Connect a Meta ad account on the Integrations page and this report will fill in after the first sync.',
  },
  never_synced: {
    title: 'Waiting for the first sync',
    body: 'Meta Ads is connected but no performance data has arrived yet. The nightly sync pulls the trailing 92 days.',
  },
  detail_not_synced: {
    title: 'Detail for this tab has not synced yet',
    body: 'Meta Ads spend and campaign totals are complete and up to date. The ad set and ad detail behind them has not been collected yet — it arrives on the nightly sync.',
  },
  no_spend_in_window: {
    title: 'No Meta spend in the selected period',
    body: 'Meta Ads is connected and has delivered data before, so this is not a sync problem — there is simply no spend in the period, practice or campaign selected. Try a wider period, or clear the practice filter.',
  },
};

export function FacebookStateNotice({
  state,
  coverage,
  scope,
}: {
  state: FacebookState;
  coverage: FacebookCoverage | null;
  /** What this payload's state and coverage were measured over. */
  scope: FacebookNoticeScope;
}) {
  if (state === 'ok') {
    // Each organisation's OWN coverage, stated plainly rather than assumed —
    // and nothing to say when there are no leads to attribute at all.
    if (!coverage || coverage.leadsTotal === 0) return null;
    return (
      <p className="text-[13px] text-ink-muted">
        {coverage.leadsWithAdSet.toLocaleString('en-GB')} of{' '}
        {coverage.leadsTotal.toLocaleString('en-GB')} leads matched to an ad set (
        {coverage.pct}
        %). The rest are counted at campaign level only.
      </p>
    );
  }

  const copy = state === 'no_ad_id_coverage' ? SCOPE_COPY[scope] : COPY[state];
  return (
    <section className="rounded-panel border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>
    </section>
  );
}
