'use client';
// Sections 1 and 2 — the deduped group total, then Google vs Facebook vs
// Unassigned. Rendered in the shared section kit so this page and the Daily
// Cockpit read as one product.
//
// Spend and the two cost metrics are deliberately NOT clickable: the
// performance endpoint returns one spend number per channel with no
// per-account or per-campaign breakdown to open, and an empty panel is worse
// than no panel. They carry an Explainer instead.
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, Kpi, Explainer } from '@/components/ui';
import { money, pct, count } from '../format';
import type { AdTotals, ChannelStats, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

export type ScorecardDrill =
  | 'leads' | 'paidLeads' | 'conversions' | 'acceptedValue' | 'overlap' | PerfChannel;

export function ChannelScorecard({
  channels,
  totals,
  overlapCount,
  drill,
  onDrill,
}: {
  channels: ChannelStats[];
  totals: AdTotals;
  overlapCount: number;
  drill: ScorecardDrill | null;
  onDrill: (d: ScorecardDrill) => void;
}) {
  return (
    <>
      <SectionCard>
        <SecHead
          n={1}
          title="Group total (deduped)"
          desc="One person counts once here even if they appear in more than one channel below. The three channel columns are not additive — this is the true group figure. Click any tile with a chevron to see the people behind it."
        />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <Kpi
            label="Leads"
            value={count(totals.leads)}
            onClick={() => onDrill('leads')}
            active={drill === 'leads'}
            info={(
              <Explainer
                what="Every person who enquired through a mapped pipeline in this window, counted once."
                how="All leads across Google, Facebook and Unassigned pipelines, deduped per person."
                now={`${count(totals.leads)} people.`}
              />
            )}
          />
          <Kpi
            label="Paid leads"
            value={count(totals.paidLeads)}
            note="Google + Facebook only — the denominator for the cost metrics"
            onClick={() => onDrill('paidLeads')}
            active={drill === 'paidLeads'}
            info={(
              <Explainer
                what="The narrower population that paid advertising can actually take credit for."
                how="Leads on Google-tagged or Facebook-tagged pipelines only, deduped per person. Unassigned pipelines are excluded because no spend maps to them."
                now={`${count(totals.paidLeads)} of ${count(totals.leads)} leads came through a paid channel.`}
              />
            )}
          />
          <Kpi
            label="In more than one channel"
            value={count(overlapCount)}
            note={overlapCount > 0 ? 'At least this many — see panel' : undefined}
            onClick={() => onDrill('overlap')}
            active={drill === 'overlap'}
            info={(
              <Explainer
                what="People who enquired through both a Google-tagged and a Facebook-tagged pipeline. They are why the channel columns do not sum to the total."
                how="Lead rows grouped by contact, keeping anyone who appears under more than one channel."
                now="A lower bound: leads with no contact record cannot be matched across channels, and detecting an overlap needs both of a person's channel rows to have survived the leads list cap — so the true figure may be higher."
              />
            )}
          />
          <Kpi
            label="Spend"
            value={money(totals.spendPence)}
            info={(
              <Explainer
                what="Advertising spend recorded against Google and Facebook in this window."
                how="Summed from the ad spend feed. Unassigned contributes nothing — no spend feed maps to it."
                now={money(totals.spendPence)}
              />
            )}
          />
          <Kpi
            label="Cost per lead"
            value={money(totals.costPerLeadPence)}
            note="Spend ÷ paid leads"
            info={(
              <Explainer
                what="What one paid enquiry costs on average."
                how="Total spend divided by paid leads. Shows 'Not reporting' when spend is unknown for either paid channel — dividing known spend by an incomplete population would understate the true cost."
                now={money(totals.costPerLeadPence)}
              />
            )}
          />
          <Kpi
            label="Conversions"
            value={count(totals.conversions)}
            onClick={() => onDrill('conversions')}
            active={drill === 'conversions'}
            info={(
              <Explainer
                what="Leads that went on to accept a treatment."
                how="A lead is a conversion when it matches an accepted treatment record from Emergent."
                now={`${count(totals.conversions)} of ${count(totals.leads)} leads converted.`}
              />
            )}
          />
          <Kpi
            label="Paid conversions"
            value={count(totals.paidConversions)}
            note="The denominator for cost per acquisition"
            info={(
              <Explainer
                what="Conversions attributable to Google or Facebook."
                how="Conversions on paid pipelines only, deduped per person."
                now={`${count(totals.paidConversions)} of ${count(totals.conversions)} conversions came through a paid channel.`}
              />
            )}
          />
          <Kpi
            label="Conversion rate"
            value={pct(totals.conversionRate)}
            info={(
              <Explainer
                what="How often an enquiry becomes an accepted treatment."
                how="Conversions divided by leads, across all channels including Unassigned — deliberately not the paid-only population, so it describes the whole funnel."
                now={pct(totals.conversionRate)}
              />
            )}
          />
          <Kpi
            label="Cost per acquisition"
            value={money(totals.costPerAcquisitionPence)}
            note="Spend ÷ paid conversions"
            info={(
              <Explainer
                what="What one accepted treatment costs in advertising."
                how="Total spend divided by paid conversions. Shows 'Not reporting' under the same rule as cost per lead."
                now={money(totals.costPerAcquisitionPence)}
              />
            )}
          />
          <Kpi
            label="Accepted value"
            value={formatPence(totals.acceptedValuePence)}
            onClick={() => onDrill('acceptedValue')}
            active={drill === 'acceptedValue'}
            info={(
              <Explainer
                what="The value of treatment accepted by people who came in as leads."
                how="Summed from the accepted treatment records in Emergent that matched a lead."
                now={formatPence(totals.acceptedValuePence)}
              />
            )}
          />
        </div>
      </SectionCard>

      <SectionCard>
        <SecHead
          n={2}
          title="By channel"
          desc="The same window split by where the enquiry came from. These three columns are not additive — someone who enquired through both Google and Facebook is counted once under each, which is correct for comparing channels but wrong for totalling them. Click a lead count to see that channel's people."
        />
        <div className="grid gap-3 md:grid-cols-3">
          {channels.map((c) => (
            <div key={c.channel}>
              <Kpi
                label={LABEL[c.channel]}
                value={count(c.leads)}
                note="leads"
                onClick={() => onDrill(c.channel)}
                active={drill === c.channel}
                info={(
                  <Explainer
                    what={
                      c.channel === 'unassigned'
                        ? 'Leads on pipelines with no channel set, so no spend can be attributed to them.'
                        : `Leads on pipelines you have mapped to ${LABEL[c.channel]}.`
                    }
                    how="Counted once per person within this channel for this window."
                    now={`${count(c.leads)} leads, ${count(c.conversions)} converted, ${formatPence(c.acceptedValuePence)} accepted.`}
                  />
                )}
              />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <Figure label="Spend" value={money(c.spendPence)} />
                <Figure label="Cost per lead" value={money(c.costPerLeadPence)} />
                <Figure label="Conversions" value={count(c.conversions)} />
                <Figure label="Conversion rate" value={pct(c.conversionRate)} />
                <Figure label="Cost per acquisition" value={money(c.costPerAcquisitionPence)} />
                <Figure label="Accepted value" value={formatPence(c.acceptedValuePence)} />
              </div>
              {c.channel === 'unassigned' ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  Map these pipelines to a channel on the ad attribution settings page to bring
                  them into the paid figures.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
