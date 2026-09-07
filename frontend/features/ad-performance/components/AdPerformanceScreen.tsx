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
// WHAT IT IS NOW. Each block renders the marketing section's OWN report body —
// the same components, hooks and endpoints the Facebook and Google pages use —
// inside its own ScopePeriodProvider. That is what makes the three surfaces
// incapable of disagreeing: there is one implementation, rendered three times,
// not three implementations of one idea. Each block therefore brings its full
// hierarchy with it: campaigns, ad sets and ads for Facebook; campaigns, ad
// groups, ads and keywords for Google.
//
// Above them sits the one figure neither report can produce, because each knows
// only its own channel: how many PEOPLE, once someone in both is counted once.

import { PageHeader, SectionCard, SecHead } from '@/components/ui';
import { ScopePeriodProvider } from '@/features/_shared/scope-context';
import { FacebookReportBody } from '@/features/marketing/facebook/components/FacebookReportScreen';
import { GoogleReportBody } from '@/features/marketing/google/components/GoogleReportScreen';
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

      {/* Facebook. Its own scope, its own tab state — `fb_` and `fbtab` — so
          changing the window or opening "Ads" here cannot move Google. */}
      <SectionCard>
        <SecHead
          n={2}
          title="Facebook"
          desc="Campaigns, ad sets and ads. The same figures as the Facebook page, from the same fetches."
        />
        <ScopePeriodProvider prefix="fb">
          <FacebookReportBody tabKey="fbtab" />
        </ScopePeriodProvider>
      </SectionCard>

      {/* Google. Google has one tier more than Facebook — ads and keywords are
          SIBLINGS under an ad group, not nested — which is why the two blocks
          show a different number of tabs. */}
      <SectionCard>
        <SecHead
          n={3}
          title="Google"
          desc="Campaigns, ad groups, ads and keywords. The same figures as the Google page, from the same fetches."
        />
        <ScopePeriodProvider prefix="g">
          <GoogleReportBody tabKey="gtab" />
        </ScopePeriodProvider>
      </SectionCard>
    </div>
  );
}
