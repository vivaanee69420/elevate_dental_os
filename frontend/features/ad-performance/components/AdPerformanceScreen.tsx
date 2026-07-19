'use client';
// Ad performance — Google vs Facebook, measured against explicitly mapped
// pipelines. Uses the shared ScopePeriod window and practice scope so it
// agrees with every other analytics screen.
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useAdPerformance, useAdLeads } from '../hooks';
import { ChannelScorecard } from './ChannelScorecard';
import { ByPracticeTable } from './ByPracticeTable';
import { ChannelTrend } from './ChannelTrend';
import { AdLeadsDrilldown } from './AdLeadsDrilldown';
import type { PerfChannel } from '../api';

export default function AdPerformanceScreen() {
  const sp = useScopePeriod();
  const practiceId = sp.scope === 'all' ? undefined : sp.scope;
  const params = useMemo(
    () => ({ since: sp.win.since, until: sp.win.until, practiceId }),
    [sp.win.since, sp.win.until, practiceId],
  );

  const { data, isLoading, error } = useAdPerformance(params);
  const [drill, setDrill] = useState<PerfChannel | null>(null);
  const leads = useAdLeads(drill !== null, { ...params, channel: drill ?? undefined });

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-slate-500">Could not load ad performance.</p>;

  const nothingMapped = data.channels.every((c) => c.channel === 'unassigned' || c.leads === 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook leads, cost per lead and conversions, from the pipelines you have mapped to each channel."
      />

      {nothingMapped ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          No pipelines are assigned to a channel yet, so there is nothing to report.{' '}
          <a className="underline" href="/settings/ad-attribution">Set up ad attribution</a>.
        </div>
      ) : null}

      <ChannelScorecard channels={data.channels} totals={data.totals} onDrill={(c) => setDrill(c === drill ? null : c)} />

      {drill !== null ? (
        <div className="rounded border border-slate-200 p-3">
          {leads.isLoading ? (
            <p className="text-sm text-slate-500">Loading leads…</p>
          ) : (
            <AdLeadsDrilldown lines={leads.data?.leads ?? []} />
          )}
        </div>
      ) : null}

      <ByPracticeTable rows={data.byPractice} />

      <ChannelTrend trend={data.trend} />

      {data.unmappedPipelineCount > 0 || data.excludedUnmappedLeads > 0 ? (
        <p className="text-[12px] text-slate-500">
          {data.unmappedPipelineCount} pipeline(s) have no channel set.{' '}
          {data.excludedUnmappedLeads.toLocaleString('en-GB')} lead(s) are on subaccounts not
          connected to a practice and are excluded.{' '}
          <a className="underline" href="/settings/ad-attribution">Review ad attribution</a>.
        </p>
      ) : null}
    </div>
  );
}
