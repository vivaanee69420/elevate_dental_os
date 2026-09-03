'use client';
// Four states, one component (Task 7 reuses it for the ad-set tier). Most
// tenants sit in one of the first three rather than the happy path, so each
// gets its own sentence — a generic empty table would leave an owner unable
// to tell "not connected" from "nothing happened".
import type { FacebookState, FacebookCoverage } from '../api';

const COPY: Record<Exclude<FacebookState, 'ok'>, { title: string; body: string }> = {
  not_connected: {
    title: 'Meta Ads is not connected',
    body: 'Connect a Meta ad account on the Integrations page and this report will fill in after the first sync.',
  },
  never_synced: {
    title: 'Waiting for the first sync',
    body: 'Meta Ads is connected but no performance data has arrived yet. The nightly sync pulls the trailing 92 days.',
  },
  no_ad_id_coverage: {
    title: 'Ad set and ad detail is not available for this organisation',
    body: 'None of the leads recorded here carry the Meta ad they came from, so leads cannot be attributed below campaign level. Spend, impressions and clicks are shown in full.',
  },
};

export function FacebookStateNotice({
  state,
  coverage,
}: {
  state: FacebookState;
  coverage: FacebookCoverage | null;
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

  const copy = COPY[state];
  return (
    <section className="rounded-panel border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>
    </section>
  );
}
