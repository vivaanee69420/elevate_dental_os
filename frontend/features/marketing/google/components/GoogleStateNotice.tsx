'use client';
// Five states, one component (every one of the four tabs uses it). Simpler
// than ../facebook/components/FacebookStateNotice.tsx on purpose: Google's
// rows are already fully attributed by the platform itself, so there is no
// coverage/scope concept and no 'no_ad_id_coverage' state to word — see
// google-report.service.js's file header, point 1.
//
// 'ok' prints nothing: Facebook's 'ok' state shows a coverage percentage,
// but Google carries no equivalent figure to state.
//
// detail_not_synced vs no_spend_in_window: BOTH read as an empty table, and
// conflating them is exactly the bug this state exists to fix. Before it,
// this component's no_spend_in_window copy — "this is not a sync problem" —
// fired whenever the deep-grain table (ad_google_adgroups/ad_google_ads/
// ad_google_keywords) was empty, EVEN WHEN THAT TABLE HAD NEVER SYNCED AT
// ALL, because the server-side probe only ever checked campaign-grain
// ad_metrics. Measured on hosted: campaign totals of £46,208 showing
// alongside "no spend in the selected period" on Ad groups, Ads and
// Keywords, on a day the deep sync simply had not run yet. detail_not_synced
// is the honest state for that case — see google-report.service.js's
// emptyWindowState.
import type { GoogleState } from '../api';

const COPY: Record<Exclude<GoogleState, 'ok'>, { title: string; body: string }> = {
  not_connected: {
    title: 'Google Ads is not connected',
    body: 'Connect a Google Ads account on the Integrations page and this report will fill in after the first sync.',
  },
  never_synced: {
    title: 'Waiting for the first sync',
    body: 'Google Ads is connected but no performance data has arrived yet. The nightly sync pulls the trailing 92 days.',
  },
  detail_not_synced: {
    title: 'Detail for this tab has not synced yet',
    body: 'Google Ads spend and campaign totals are complete and up to date. The ad group, ad and keyword detail behind them has not been collected yet — it arrives on the nightly sync.',
  },
  no_spend_in_window: {
    title: 'No Google spend in the selected period',
    body: 'Google Ads is connected and has delivered data before, so this is not a sync problem — there is simply no spend in the period, practice, campaign or ad group selected. Try a wider period, or clear the filter.',
  },
};

export function GoogleStateNotice({ state }: { state: GoogleState }) {
  if (state === 'ok') return null;
  const copy = COPY[state];
  return (
    <section className="rounded-panel border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>
    </section>
  );
}
