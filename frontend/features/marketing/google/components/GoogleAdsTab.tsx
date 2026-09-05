'use client';
// Google report — Ads tab. The SIBLING of the Keywords tab under an ad group,
// so both take the SAME `parentId` (an ad group id) rather than one nesting
// inside the other.
//
// EVERY AD USED TO RENDER AS A 12-DIGIT NUMBER. ad_group_ad.ad.name is an
// optional internal label and almost no advertiser sets one — measured on this
// org's live tables, 0 of 186 ads had a name. The connector now falls back to
// the ad's first responsive-search headline, so the first column finally says
// what the ad actually says, and the rest of the creative is one click away in
// the expansion panel.
import { EmptyState } from '@/components/ui';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { SectionHead } from '../../_shared/StatRail';
import { Chip, humanise } from '../../_shared/Bars';
import { num, DASH } from '../../_shared/format';
import { nameColumn, deliveryColumns } from './columns';
import { GoogleTabFrame, ShowMore } from './GoogleTabFrame';
import { useGoogleAds } from '../hooks';
import type { GoogleAdRow } from '../api';

// Google's approval verdict is the one enum on this page that carries a real
// judgement, so it is the one that gets a colour. Everything else stays
// neutral — a page where several things are coloured is a page where none of
// them mean anything.
function approvalTone(status: string | null): 'neutral' | 'bad' | 'muted' {
  if (!status) return 'muted';
  if (/DISAPPROVED/i.test(status)) return 'bad';
  return 'neutral';
}

// The creative, shown in place. This is what an ad IS — the rest of the row is
// what happened to it — and until the connector pulled headlines there was no
// way to see it in Elevate at all.
function AdCreative({ row }: { row: GoogleAdRow }) {
  const headlines = row.headlines ?? [];
  const descriptions = row.descriptions ?? [];
  if (headlines.length === 0 && descriptions.length === 0 && !row.finalUrl) {
    return (
      <p className="text-[12px] text-ink-muted">
        No creative recorded for this ad. Google returns headlines and descriptions for
        responsive search ads; other formats (image, video, Performance Max assets) carry
        their content elsewhere.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      {headlines.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            Headlines
          </p>
          {/* Google assembles a responsive search ad from these at auction
              time — it does NOT show them all at once, and the order here is
              the order they were declared, not an order anyone saw. Said
              plainly so the panel is not read as a preview of the live ad. */}
          <p className="text-ink">{headlines.join('  ·  ')}</p>
        </div>
      )}
      {descriptions.length > 0 && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            Descriptions
          </p>
          <p className="text-ink">{descriptions.join('  ·  ')}</p>
        </div>
      )}
      {row.finalUrl && (
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
            Landing page
          </p>
          {/* First of possibly several final URLs — the field is named for
              what it is rather than pretending to be "the" URL. */}
          <a
            href={row.finalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-brand hover:underline"
          >
            {row.finalUrl}
          </a>
        </div>
      )}
      <p className="text-[11.5px] text-ink-muted">
        Google assembles these into an ad at auction time; this is the pool it draws from,
        not a single ad anyone saw.
      </p>
    </div>
  );
}

export function GoogleAdsTab({ parentId }: { parentId: string | null }) {
  const {
    data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useGoogleAds(parentId);

  const first = data?.pages[0];
  const rows = data?.pages.flatMap((p) => p.rows) ?? [];
  const maxSpend = rows.reduce((m, r) => Math.max(m, r.spendPence), 0);

  const columns: GridColumn<GoogleAdRow>[] = [
    nameColumn<GoogleAdRow>('Ad', maxSpend, 'Unnamed ad'),
    ...deliveryColumns<GoogleAdRow>(),
    {
      key: 'strength', header: 'Ad strength', align: 'right', width: 'w-[120px]',
      sortBy: (r) => r.adStrength ?? null,
      render: (r) => (r.adStrength ? <Chip>{humanise(r.adStrength)}</Chip> : DASH),
      sub: (r) => (r.approvalStatus && /DISAPPROVED|LIMITED/i.test(r.approvalStatus)
        ? <Chip tone={approvalTone(r.approvalStatus)}>{humanise(r.approvalStatus)}</Chip>
        : null),
    },
  ];

  return (
    <GoogleTabFrame
      state={first?.state}
      isLoading={isLoading}
      isError={isError}
      errorLabel={`Couldn't load ads: ${(error as Error)?.message ?? 'unknown error'}`}
      windowClamped={first?.windowClamped}
      effectiveSince={first?.effectiveSince}
      excludedAccounts={first?.excludedAccounts}
      footer={(
        <ShowMore
          hasNext={Boolean(hasNextPage)}
          isFetching={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          label="Show more ads"
        />
      )}
    >
      <div className="flex flex-col gap-2">
        <SectionHead
          title="Ads"
          note="Open a row to read the headlines and descriptions Google draws the ad from."
          right={<span className="text-[12px] text-ink-muted">{num(rows.length)} shown</span>}
        />
        <DeferUntilVisible minHeight={360}>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.id}-${r.parentId ?? ''}`}
            emptyState={<EmptyState message="No ads with spend in this window." />}
            rowTone={(r) => (r.spendPence > 0 ? 'default' : 'muted')}
            renderExpanded={(r) => <AdCreative row={r} />}
          />
        </DeferUntilVisible>
      </div>
    </GoogleTabFrame>
  );
}
