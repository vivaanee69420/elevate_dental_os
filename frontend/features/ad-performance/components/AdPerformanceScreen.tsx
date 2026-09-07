'use client';
// Ad performance — Google and Facebook, each reported by the service that owns
// it, on filters of its own.
//
// WHAT WAS WRONG. The page had its own implementation: it measured acceptance
// by joining Emergent accepted treatments while the Facebook and Google report
// pages measured it by settled payments over a floor. Two definitions of one
// word on two screens, and this page's produced zeros — live, Sep 2026, it read
// 0 conversions, 0.0% conversion rate, "Not reporting" cost per acquisition and
// £0 accepted beside £7,103.97 of spend.
//
// It also had ONE filter row driving both channels, which cannot be right: the
// two run on different data with different histories (Meta's deep-grain tables
// hold a rolling 92 days, Google's do not), so a single window either clamps
// Google needlessly or clamps Facebook silently.
//
// WHAT IT IS NOW. A decision summary, not a second copy of the report pages.
// Each block shows the figures worth acting on — spend, the lead-to-patient
// funnel, where the money went, what changed since last period, and the two
// campaigns that deserve attention — then hands over to the full report for the
// grain beneath it. Reproducing those tables here made one long page that
// answered neither question well.
//
// It fetches with the report pages' OWN hooks, so the summary is a smaller view
// of one dataset rather than a second calculation of it, and the two surfaces
// cannot disagree about the same window.
//
// Above them sits the one figure neither report can produce, because each knows
// only its own channel: how many PEOPLE, once someone in both is counted once.

import { PageHeader, SectionCard, SecHead } from '@/components/ui';
import { ScopePeriodProvider } from '@/features/_shared/scope-context';
import { FacebookSummary } from './FacebookSummary';
import { GoogleSummary } from './GoogleSummary';
import { GroupTotalBlock } from './GroupTotalBlock';

export default function AdPerformanceScreen() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook side by side. Each channel keeps its own window and practice filter, because the two are measured over different histories."
      />

      {/* The cross-channel answer, on the page's own window. Deliberately
          separate from the two blocks below: it is the only figure here that
          needs both channels at once, and the only one not delegated. */}
      <GroupTotalBlock />

      {/* Facebook, in its own scope (`fb_`), so changing its window or
          practice cannot move Google. */}
      <SectionCard>
        <SecHead
          n={2}
          title="Facebook"
          desc="Spend, funnel and the campaigns worth a decision. Open the full report for ad sets and ads."
        />
        <ScopePeriodProvider prefix="fb">
          <FacebookSummary />
        </ScopePeriodProvider>
      </SectionCard>

      {/* Google, in its own scope (`g_`). It offers one way in more than
          Facebook: its ads and keywords are SIBLINGS under an ad group rather
          than nested, so neither is reachable through the other. */}
      <SectionCard>
        <SecHead
          n={3}
          title="Google"
          desc="Spend, funnel and the campaigns worth a decision. Open the full report for ad groups, ads and keywords."
        />
        <ScopePeriodProvider prefix="g">
          <GoogleSummary />
        </ScopePeriodProvider>
      </SectionCard>
    </div>
  );
}
