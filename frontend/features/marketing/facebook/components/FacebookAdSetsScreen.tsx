'use client';
// Facebook report — ad-set tier, with ads expanding in place beneath each ad
// set. Sibling of the campaign tier (FacebookCampaignsScreen): same table
// idiom, same FacebookStateNotice, same clamp handling — so this reads as
// part of one report rather than a second design. The click-to-expand row
// (▸/▾ marker, Set<string> of open ids) is PLMarginScreen's existing idiom,
// matched here rather than inventing a second one.
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { formatPence, formatDate } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useFacebookAdSets, useFacebookCampaigns } from '../hooks';
import { FacebookStateNotice } from './FacebookStateNotice';
import { FacebookAdRows } from './FacebookAdRows';
import type { FacebookRow, FacebookFunnelTotals } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
// null when there were no impressions/clicks to divide by — unknowable, not zero.
const ctrPct = (ctr: number | null) => (ctr === null ? '—' : `${(ctr * 100).toFixed(2)}%`);
const num = (n: number) => n.toLocaleString('en-GB');

const TH = 'px-4 py-3 text-right font-medium text-ink-muted';
const TD = 'px-4 py-3 text-right tabular-nums';
// Ad set, Spend, Impressions, Clicks, CTR, CPC, Leads, Booked, Attended,
// Patients, CPL, CPB, CPA.
//
// There is no Reach column. ad_grain_rollup's RETURNS TABLE does not include
// reach — the value IS stored on ad_meta_adsets, but the rollup never returns
// it, so the column rendered an em dash on every row, under a header tooltip
// and a footnote explaining a number that never appeared. Restoring it needs a
// new RPC and a migration; an always-empty column is worse than no column.
const COLS = 13;

// Calm, factual prose — never an error/warning colour. Matches
// FacebookCampaignsScreen's Note: these are facts about the data, not
// problems with it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-bg px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

function AdSetRow({ row, isOpen, onToggle }: {
  row: FacebookRow; isOpen: boolean; onToggle: () => void;
}) {
  return (
    <tr className="border-t border-border cursor-pointer hover:bg-bg" onClick={onToggle}>
      <td className="px-4 py-3">
        <span className="inline-block w-3 mr-1 text-[10px] text-ink-muted" aria-hidden>
          {isOpen ? '▾' : '▸'}
        </span>
        <span className="font-medium text-ink">{row.name ?? row.id ?? 'Unnamed ad set'}</span>
      </td>
      <td className={TD}>{money(row.spendPence)}</td>
      <td className={TD}>{num(row.impressions)}</td>
      <td className={TD}>{num(row.clicks)}</td>
      <td className={TD}>{ctrPct(row.ctr)}</td>
      <td className={TD}>{money(row.cpcPence)}</td>
      <td className={TD}>{num(row.leads)}</td>
      <td className={TD}>{num(row.booked)}</td>
      <td className={TD}>{num(row.attended)}</td>
      <td className={TD}>{num(row.patients)}</td>
      <td className={TD}>{money(row.cplPence)}</td>
      <td className={TD}>{money(row.cpbPence)}</td>
      <td className={TD}>{money(row.cpaPence)}</td>
    </tr>
  );
}

// TWO bucket rows, not one, because there are two distinct ways a lead of
// this campaign can fail to sit in an ad-set row above — and folding them
// together, or omitting either, loses leads outright: the campaign tier would
// say 100 while this table summed to 80.
//
//  - "Ad set not identified": Meta never told us which ad set the lead came
//    from (ad_set_id null).
//  - "Ad set not shown here": the ad set resolved, but has no spend row in
//    this window — no delivery, or its spend sits under a different practice
//    mapping than the current filter.
//
// Both carry leads and no spend, so spend and every cost column are em dashes
// rather than an invented number, and so are the platform metrics
// (impressions/clicks/CTR/CPC) — there is no ad-set row behind them to read
// those from, and a zero would read as "this ad set was shown to nobody".
function BucketRow({ label, title, funnel }: {
  label: string; title: string; funnel: FacebookFunnelTotals;
}) {
  return (
    <tr className="border-t border-border bg-bg">
      <td className="px-4 py-3">
        <span className="italic text-ink-muted" title={title}>{label}</span>
      </td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
      <td className={TD}>{num(funnel.leads)}</td>
      <td className={TD}>{num(funnel.booked)}</td>
      <td className={TD}>{num(funnel.attended)}</td>
      <td className={TD}>{num(funnel.patients)}</td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
      <td className={TD}>—</td>
    </tr>
  );
}

export default function FacebookAdSetsScreen() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = decodeURIComponent(String(params?.campaignId ?? ''));
  const { data, isLoading, isError, error } = useFacebookAdSets(campaignId);

  // No new endpoint for the campaign's name: it comes from the campaigns
  // payload the table one level up already fetched and cached — the same
  // "reuse the call the app already made" idiom as the sibling
  // CampaignDetailScreen (marketing-campaigns/[campaignId]).
  const campaigns = useFacebookCampaigns();
  const campaignName = (campaigns.data?.rows ?? []).find((r) => r.id === campaignId)?.name ?? null;

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rows = data?.rows ?? [];
  // Platform metrics stand on their own even without ad-id coverage; only
  // 'not_connected'/'never_synced' have literally nothing to show. An empty
  // window ('no_spend_in_window') still shows the table when there are
  // unplaceable leads to account for — that is exactly the case where the
  // campaign tier reports leads and this tier must not silently show none.
  const showTable = data && (
    data.state === 'ok'
    || data.state === 'no_ad_id_coverage'
    || (data.state === 'no_spend_in_window' && Boolean(data.notIdentified || data.unmatchedLeads))
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={campaignName ? `Ad sets — ${campaignName}` : 'Ad sets'}
        subtitle="Meta ad set performance for this campaign — click a row to see the ads beneath it. Attendance is recorded in Dentally only."
      />
      <div>
        <Link href="/marketing-facebook" className="text-[13px] text-brand hover:underline">
          Back to Facebook campaigns
        </Link>
      </div>
      <ScopePeriodBar />

      {isError ? (
        <EmptyState message={`Couldn't load ad sets: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading && !data ? (
        <SkeletonTable rows={8} cols={COLS} />
      ) : data ? (
        <>
          {/* scope="campaign": everything on this screen is measured over ONE
              campaign, so the coverage notice must say so rather than make a
              claim about the whole organisation. */}
          <FacebookStateNotice state={data.state} coverage={data.coverage} scope="campaign" />

          {data.windowClamped && (
            <Note>
              Ad set and ad detail is kept for 92 days. This period reaches further back
              than that, so figures below are shown from {formatDate(data.effectiveSince)}
              {' '}onward rather than the whole period.
            </Note>
          )}

          {showTable && (
            rows.length === 0 && !data.notIdentified && !data.unmatchedLeads ? (
              <EmptyState message="No Facebook ad set spend in this window." />
            ) : (
              <DeferUntilVisible minHeight={360}>
                <div className="overflow-x-auto rounded-panel border border-border bg-surface">
                  <table className="w-full text-[13.5px]">
                    <thead className="bg-bg">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-ink-muted">Ad set</th>
                        <th className={TH}>Spend</th>
                        <th className={TH}>Impressions</th>
                        <th className={TH}>Clicks</th>
                        <th className={TH}>CTR</th>
                        <th className={TH}>CPC</th>
                        <th className={TH}>Leads</th>
                        <th className={TH}>Booked</th>
                        <th
                          className={TH}
                          title="Dentally-only: a GoHighLevel booking cannot say whether someone turned up."
                        >
                          Attended*
                        </th>
                        <th className={TH}>Patients</th>
                        <th className={TH}>CPL</th>
                        <th className={TH}>CPB</th>
                        <th className={TH}>CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const id = r.id ?? `row-${i}`;
                        const isOpen = open.has(id);
                        return (
                          <Fragment key={id}>
                            <AdSetRow row={r} isOpen={isOpen} onToggle={() => r.id && toggle(r.id)} />
                            {r.id && <FacebookAdRows adSetId={r.id} expanded={isOpen} />}
                          </Fragment>
                        );
                      })}
                      {data.notIdentified && (
                        <BucketRow
                          label="Ad set not identified"
                          title="Leads attributed to this campaign whose ad set Meta did not report. Their spend cannot be split back out from the real ad sets above, so no cost is shown for them."
                          funnel={data.notIdentified}
                        />
                      )}
                      {data.unmatchedLeads && (
                        <BucketRow
                          label="Ad set not shown here"
                          title="Leads whose ad set is known but has no spend in this period — either it was not delivering, or its spend belongs to a practice outside the current filter. Counted here so this table still adds up to the campaign total."
                          funnel={data.unmatchedLeads}
                        />
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[12px] text-ink-muted">
                  * Attended is Dentally-only — a GoHighLevel booking alone cannot say whether
                  someone turned up.
                </p>
              </DeferUntilVisible>
            )
          )}
        </>
      ) : null}
    </div>
  );
}
