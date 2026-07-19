'use client';
// Ad attribution settings — three ordered steps. The order matters: pipelines
// inherit their practice from the subaccount, and spend can only be split by
// practice once ad accounts are connected. Steps 2 and 3 are dimmed and
// non-interactive until at least one subaccount is connected so the operator
// is guided through the sequence rather than confronted with three equal
// panels — see the report for a note on the accessibility trade-off this makes.
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
      <div className={anyMapped ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-50'}>
        <PipelineChannelStep config={data} />
        <AdAccountPracticeStep config={data} />
      </div>
      {!anyMapped ? (
        <p className="text-[13px] text-slate-500">
          Connect at least one subaccount to a practice to continue.
        </p>
      ) : null}
    </div>
  );
}
