'use client';
// Ad performance — Google vs Facebook, measured against explicitly mapped
// pipelines, in the Daily Cockpit's section language. Uses the shared
// ScopePeriod window and practice scope so it agrees with every other
// analytics screen.
//
// ONE leads request serves every drill-down: useAdLeads is called without a
// channel filter and each panel filters the result in memory. Do not add a
// per-channel fetch — it would fire a request per tile and let the panels
// disagree with one another.
import { useMemo, useState } from 'react';
import { SectionCard, SecHead, DetailPanel, cx, cockpitStyles as s } from '@/components/ui';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useAdPerformance, useAdLeads } from '../hooks';
import { ChannelScorecard, type ScorecardDrill } from './ChannelScorecard';
import { ByPracticeTable } from './ByPracticeTable';
import { ChannelTrend } from './ChannelTrend';
import { AdLeadsDrilldown } from './AdLeadsDrilldown';
import { AttributionSection } from './AttributionSection';
import { OverlapTable } from './OverlapTable';
import { distinctPeople, overlapPeople } from '../derive';
import { count } from '../format';
import { LEAD_FETCH_LIMIT, type AdLeadLine } from '../api';

const PANEL_TITLE: Record<ScorecardDrill, string> = {
  leads: 'Every lead',
  paidLeads: 'Paid leads',
  conversions: 'Leads that converted',
  acceptedValue: 'Leads with accepted treatment',
  overlap: 'People counted under more than one channel',
  google_ads: 'Google Ads leads',
  meta_ads: 'Facebook Ads leads',
  unassigned: 'Unassigned leads',
};

const PANEL_SUB: Record<ScorecardDrill, string> = {
  leads: 'One row per person, newest first.',
  paidLeads: 'People who came in through a Google-tagged or Facebook-tagged pipeline.',
  conversions: 'People who went on to accept a treatment.',
  acceptedValue: 'Highest accepted value first.',
  overlap: 'People counted under more than one channel column — Google, Facebook or Unassigned — which is why the channel columns do not add up to the group total. This is a lower bound — leads with no contact record cannot be matched across channels, and detecting an overlap needs both of a person\'s channel rows to have survived the leads list cap, so truncation shrinks this count further.',
  google_ads: 'People on pipelines mapped to Google Ads.',
  meta_ads: 'People on pipelines mapped to Facebook Ads.',
  unassigned: 'People on pipelines with no channel set.',
};

// Which rows a given drill-down shows. Every branch works off the same fetched
// list so the panels can never disagree with one another. 'overlap' is handled
// separately by the caller (OverlapTable), so it is excluded from the type here
// rather than returning a dead [] branch.
function rowsFor(drill: Exclude<ScorecardDrill, 'overlap'>, lines: AdLeadLine[]): AdLeadLine[] {
  switch (drill) {
    case 'leads':
      return distinctPeople(lines);
    case 'paidLeads':
      return distinctPeople(lines.filter((l) => l.channel !== 'unassigned'));
    case 'conversions':
      return distinctPeople(lines.filter((l) => l.converted));
    case 'acceptedValue':
      return distinctPeople(lines.filter((l) => l.matchedValuePence > 0))
        .sort((a, b) => b.matchedValuePence - a.matchedValuePence);
    default:
      return lines.filter((l) => l.channel === drill);
  }
}

// The header and filter bar render in every state, including loading and
// error. If they only rendered on success, a window that failed to load would
// leave the operator with no control to change it, and every filter change
// would flash the whole page chrome away.
//
// Declared at module scope on purpose: a component defined inside the render
// function gets a new identity each render, which remounts the whole subtree
// and drops focus from the month selector.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <div className={s.wrap}>
        <div className={s.topbar}>
          <div className={s.h1}>Ad performance</div>
          <div className={s.sub}>
            Google and Facebook leads, cost per lead and conversions, from the pipelines you
            have mapped to each channel.
          </div>
          <div style={{ marginTop: 14 }}>
            <ScopePeriodBar />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AdPerformanceScreen() {
  const sp = useScopePeriod();
  const practiceId = sp.scope === 'all' ? undefined : sp.scope;
  const params = useMemo(
    () => ({ since: sp.win.since, until: sp.win.until, practiceId }),
    [sp.win.since, sp.win.until, practiceId],
  );

  const { data, isLoading, error } = useAdPerformance(params);
  const [drill, setDrill] = useState<ScorecardDrill | null>(null);

  // Fetched for the attribution section as well as the drill-downs, so it is
  // enabled unconditionally once the page has data rather than on drill.
  const leads = useAdLeads(Boolean(data), params);
  const lines = useMemo(() => leads.data?.leads ?? [], [leads.data]);
  const overlap = useMemo(() => overlapPeople(lines), [lines]);

  if (isLoading) return <Frame><div className={s.stateBox}>Loading…</div></Frame>;
  if (error || !data) {
    return (
      <Frame>
        <div className={cx(s.stateBox, s.errorBox)}>Could not load ad performance.</div>
      </Frame>
    );
  }

  const noPaidLeads = data.channels.every((c) => c.channel === 'unassigned' || c.leads === 0);
  const practiceSelected = sp.scope !== 'all';
  // Distinguish "nothing is mapped yet" (a real setup gap — send the operator
  // to fix it) from "everything is mapped, this window is just quiet" (true
  // but would send them to redo work that's already done if conflated).
  //
  // Both flags mix an operand that IS practice-scoped (noPaidLeads, derived
  // from data.channels) with one that is NOT (data.unmappedPipelineCount is
  // org-wide, never narrowed by the practice selector). With a practice
  // selected, a quiet practice plus an unmapped pipeline anywhere else in the
  // organisation would wrongly trip "nothing mapped", and a quiet practice
  // with zero unmapped pipelines would wrongly claim the whole organisation
  // is quiet. So: group view only. Do not re-widen these to practice view
  // without also scoping data.unmappedPipelineCount to the practice.
  const nothingMapped = !practiceSelected && noPaidLeads && data.unmappedPipelineCount > 0;
  const mappedButQuiet = !practiceSelected && noPaidLeads && data.unmappedPipelineCount === 0;
  const hasMappingGap = data.unmappedPipelineCount > 0 || data.excludedUnmappedLeads > 0;

  // A practice selection scopes leads, conversions, accepted value and the
  // trend, but not spend: ad_metrics.practice_id is null on every synced row,
  // so per-practice spend, cost per lead and cost per acquisition come back
  // null. Say so rather than letting the operator read blank tiles as a fault.
  //
  // The copy deliberately does NOT promise that mapping an ad account fixes
  // this today. adSpend reads ad_metrics.practice_id directly, which the
  // connectors hardcode to null, so a mapping alone changes nothing until the
  // separately-specced customer_id -> practice_id join ships. Promising an
  // immediate fix would send the operator to do work with no visible result.
  const spendIsGroupWide = practiceSelected && data.totals.spendPence === null;
  // With no leads for this practice the service returns synthetic zeros, which
  // would otherwise read as a measured result rather than an absence.
  const practiceHasNoLeads = practiceSelected && data.totals.leads === 0;

  return (
    <Frame>
      {nothingMapped ? (
        <div className={cx(s.notice, s.noticeWarn)}>
          No pipelines are assigned to a channel yet, so there is nothing to report.{' '}
          <a className="underline" href="/settings/ad-attribution">Set up ad attribution</a>.
        </div>
      ) : null}

      {mappedButQuiet ? (
        <div className={s.notice}>
          No Google or Facebook leads in this window. Pipelines are already mapped to a
          channel — this is just a quiet period.
        </div>
      ) : null}

      {spendIsGroupWide ? (
        <div className={s.notice}>
          Leads, conversions and treatment value are for this practice. Spend, cost per lead
          and cost per acquisition cannot be shown for a single practice: advertising spend is
          recorded for the organisation as a whole rather than per practice, so it cannot be
          split between them. Switch to All practices to see group spend.
        </div>
      ) : null}

      {practiceHasNoLeads ? (
        <div className={s.notice}>
          No ad leads are attributed to this practice in this window. The figures below are
          zero because there is nothing to count, not because the campaigns measured zero.
        </div>
      ) : null}

      <ChannelScorecard
        channels={data.channels}
        totals={data.totals}
        overlapCount={overlap.length}
        overlapLoading={leads.isLoading}
        overlapError={leads.isError}
        drill={drill}
        onDrill={(d) => setDrill(d === drill ? null : d)}
      />

      {drill !== null ? (
        <DetailPanel title={PANEL_TITLE[drill]} sub={PANEL_SUB[drill]}>
          {leads.isLoading ? (
            <p className="text-sm text-slate-500">Loading leads…</p>
          ) : leads.isError ? (
            <p className="text-sm text-red-700">
              Could not load the leads behind this panel. Try again shortly.
            </p>
          ) : (
            <>
              {lines.length >= LEAD_FETCH_LIMIT ? (
                <div className={cx(s.notice, s.noticeWarn)}>
                  This list is incomplete — the leads it is built from were truncated to{' '}
                  {count(LEAD_FETCH_LIMIT)} rows, which is an arbitrary sample rather than the
                  most recent leads. This panel may not match the tile above it.
                </div>
              ) : null}
              {drill === 'overlap' ? (
                <OverlapTable people={overlap} />
              ) : (
                <AdLeadsDrilldown lines={rowsFor(drill, lines)} />
              )}
            </>
          )}
        </DetailPanel>
      ) : null}

      <AttributionSection
        lines={lines}
        totalAcceptedPence={data.totals.acceptedValuePence}
        loading={leads.isLoading}
        error={leads.isError}
      />

      <ByPracticeTable rows={data.byPractice} />

      <ChannelTrend trend={data.trend} />

      {hasMappingGap ? (
        <SectionCard>
          <SecHead
            n={6}
            title="Mapping health"
            desc="What is missing from the figures above, and why."
            tone="ok"
          />
          <ul className="ml-4 list-disc text-[13px] text-slate-700">
            {data.unmappedPipelineCount > 0 ? (
              <li className="py-1">
                <strong>
                  {count(data.unmappedPipelineCount)} {data.unmappedPipelineCount === 1 ? 'pipeline has' : 'pipelines have'} no channel set.
                </strong>{' '}
                Their leads appear under Unassigned and no advertising spend can be attributed
                to them, so they pull the group conversion rate down without contributing to
                cost per lead. This count is group-wide — it is not narrowed by the practice
                selector above.
              </li>
            ) : null}
            {data.excludedUnmappedLeads > 0 ? (
              <li className="py-1">
                <strong>
                  {count(data.excludedUnmappedLeads)} {data.excludedUnmappedLeads === 1 ? 'lead is' : 'leads are'} excluded entirely.
                </strong>{' '}
                They sit on GoHighLevel subaccounts that are not connected to a practice, so
                they cannot be attributed to anywhere and are left out of every other figure on
                this page rather than being counted against the wrong practice. This count is
                also group-wide, computed before any practice filter, so it does not shrink when
                you scope to one practice.
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">
            <a className="underline" href="/settings/ad-attribution">Review ad attribution</a> to
            close these gaps.
          </p>
        </SectionCard>
      ) : null}
    </Frame>
  );
}
