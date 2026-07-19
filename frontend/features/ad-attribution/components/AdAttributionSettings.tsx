'use client';
// Ad attribution settings — three ordered steps. The order matters: pipelines
// inherit their practice from the subaccount, and spend can only be split by
// practice once ad accounts are connected. Steps 2 and 3 are dimmed (not
// blocked) until at least one subaccount is connected, as a visual nudge to
// do Step 1 first. This is guidance, not a hard requirement — nothing breaks
// if an operator works through Step 2 or 3 first — so the steps stay fully
// interactive by mouse, keyboard and assistive technology. Do NOT reintroduce
// `pointer-events-none` (or `inert`/`disabled`/`tabIndex={-1}`) here: it would
// block mouse interaction while leaving the controls focusable and
// operable via keyboard/screen reader, an inconsistent half-blocked state
// that is worse than not blocking at all.
import { PageHeader } from '@/components/ui';
import { useAdAttributionConfig } from '../hooks';
import SubaccountPracticeStep from './SubaccountPracticeStep';
import PipelineChannelStep from './PipelineChannelStep';
import AdAccountPracticeStep from './AdAccountPracticeStep';

export default function AdAttributionSettings() {
  const { data, isLoading, error } = useAdAttributionConfig();

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) {
    return <p className="p-6 text-sm text-slate-500">Could not load ad attribution settings.</p>;
  }

  const anyMapped = data.subaccounts.some((s) => s.practiceId !== null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad attribution"
        subtitle="Tell Elevate which pipelines count as Google and Facebook leads, so cost per lead and conversions are measured against the right spend."
      />
      <SubaccountPracticeStep config={data} />
      <div className={anyMapped ? 'space-y-4' : 'space-y-4 opacity-50'}>
        <PipelineChannelStep config={data} />
        <AdAccountPracticeStep config={data} />
      </div>
      {!anyMapped ? (
        <p className="text-[13px] text-slate-500">
          Connecting a subaccount to a practice first is what makes pipeline and ad
          account mapping below meaningful — pipelines inherit their practice from the
          subaccount, and spend can only be split by practice once accounts are mapped.
          You can still set these up in any order.
        </p>
      ) : null}
    </div>
  );
}
