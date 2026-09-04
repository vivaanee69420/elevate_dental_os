'use client';
// Four states, one component (every one of the four tabs uses it). Simpler
// than ../facebook/components/FacebookStateNotice.tsx on purpose: Google's
// rows are already fully attributed by the platform itself, so there is no
// coverage/scope concept and no 'no_ad_id_coverage' state to word — see
// google-report.service.js's file header, point 1.
//
// 'ok' prints nothing: Facebook's 'ok' state shows a coverage percentage,
// but Google carries no equivalent figure to state.
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
