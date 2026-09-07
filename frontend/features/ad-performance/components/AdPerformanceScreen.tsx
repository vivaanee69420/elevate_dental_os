'use client';
// Ad performance — Facebook and Google as two sub-pages over one window.
//
// WHAT WAS WRONG WITH THE NUMBERS. The page had its own implementation, which
// measured acceptance by joining Emergent accepted treatments while the
// Facebook and Google report pages measured it by settled payments over a
// floor. Two definitions of one word on two screens, and this page's produced
// zeros: live, Sep 2026, it read 0 conversions, 0.0% conversion rate, "Not
// reporting" cost per acquisition and £0 accepted beside £7,103.97 of spend.
// Every figure here now comes from the report pages' OWN hooks, so this is a
// smaller view of one dataset rather than a second calculation of it.
//
// WHY TABS AND NOT TWO STACKED BLOCKS. Stacked, the page carried three cards,
// three filter rows and the channel name printed twice, separated by bands of
// empty space. It also forced a choice between one window that silently clamps
// a channel and two windows that quietly disagree. With one channel on screen
// at a time, a single filter row is unambiguous: it filters what you are
// looking at.
//
// The cross-channel figures sit ABOVE the tabs because they belong to neither
// channel — they are the only numbers here that need both at once, and the only
// ones not delegated.

import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { AdReportTabs, useAdReportTab, type AdReportTab } from '@/features/marketing/_shared/AdReportTabs';
import { useFacebookLeadPerformance } from '@/features/marketing/facebook/hooks';
import { useGoogleLeadPerformance } from '@/features/marketing/google/hooks';
import { GroupTotalBlock } from './GroupTotalBlock';
import { FacebookSummary } from './FacebookSummary';
import { GoogleSummary } from './GoogleSummary';

const TABS: AdReportTab[] = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'google', label: 'Google' },
];

/**
 * Warms BOTH channels' headline figures while one is on screen.
 *
 * The hooks cache for five minutes, so only the FIRST switch was slow — and it
 * was slow for a reason worth keeping: opening Google fires seven cold queries
 * (its headline, its comparison, and five grains). Fetching the two headline
 * queries up front means the cards are already there when the tab changes, and
 * only the grains stream in behind them. Renders nothing; it exists for its
 * cache entries, which the tab's own hooks then read instead of refetching.
 *
 * Deliberately NOT the grains too: those are five more requests per channel for
 * a tab the reader may never open, and the cards are what makes a switch feel
 * immediate.
 */
function WarmBothChannels() {
  useFacebookLeadPerformance();
  useGoogleLeadPerformance();
  return null;
}

export default function AdPerformanceScreen() {
  const [tab, setTab] = useAdReportTab(TABS);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Ad performance"
        subtitle="What the spend bought, and which campaign, ad set, ad or keyword deserves a decision. Open a channel's full report for the tables beneath."
      />

      {/* The GLOBAL period, once. Practices are chosen per channel below,
          because which ones can honestly be offered depends on which have an
          account with THAT platform. */}
      <ScopePeriodBar hideScope />

      <WarmBothChannels />

      {/* The tab strip and the way out on ONE row. As its own line the link
          cost a full row of vertical space to say four words. */}
      <div className="flex items-end justify-between gap-3 border-b border-border">
        <AdReportTabs tabs={TABS} active={tab} onChange={setTab} />
        <Link
          href={tab === 'facebook' ? '/marketing-facebook' : '/marketing-google'}
          className="shrink-0 pb-2.5 text-[12.5px] font-medium text-brand hover:underline"
        >
          Open the full {tab === 'facebook' ? 'Facebook' : 'Google'} report →
        </Link>
      </div>

      {/* The channel's OWN accounts, directly under its tab, because that is
          what the tab just selected. Only practices with an account on this
          platform are offered — one without can render nothing but a confident
          zero, which reads as "we spent nothing here" rather than "this
          practice is not connected". */}
      <ScopePeriodBar hidePeriod adProvider={tab === 'facebook' ? 'meta_ads' : 'google_ads'} />

      {/* Below the choice it depends on: the cross-channel figures answer for
          whichever practices are selected above. */}
      <GroupTotalBlock />


      {tab === 'facebook' && <FacebookSummary />}
      {tab === 'google' && <GoogleSummary />}
    </div>
  );
}
