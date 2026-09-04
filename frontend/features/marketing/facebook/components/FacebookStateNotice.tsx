'use client';
// Five states, one component (the ad-set tier reuses it). Most tenants sit in
// one of the non-happy states rather than the happy path, so each gets its own
// sentence — a generic empty table would leave an owner unable to tell "not
// connected" from "nothing happened".
//
// TWO of these sentences are about a fact this component cannot see on its
// own, so both are parameterised rather than guessed:
//
//  - never_synced vs no_spend_in_window. "No performance data has arrived yet"
//    used to fire whenever the WINDOW was empty, which told a tenant who
//    paused their campaigns two months ago — or simply picked a quiet day —
//    that they had never synced. The server now distinguishes the two by
//    probing outside the window, and the quiet-window case gets its own
//    honest sentence.
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
