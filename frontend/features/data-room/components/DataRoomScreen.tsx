'use client';

// Data Room — one screen for every source. Practice pills + period (shared
// ScopePeriodBar), a dataset pill row (from the API registry), a streamed
// CSV export, and a keyset-paginated table. PII columns never reach this
// screen unless the caller is an owner who switched "Include patient PII" on.

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useMe } from '@/hooks/useMe';
import { DataTable, EmptyState, PageHeader, AlertRow, SkeletonTable, type Column } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useDataRoomPage, useDataRoomRegistry } from '../hooks';
import { dataRoomExportUrl, type DataRoomRow, type DataRoomSourceKey } from '../api';

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatCell(col: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (col.endsWith('_pence') && typeof v === 'number') return formatPence(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && ISO_TS.test(v)) {
    return new Date(v).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  }
  return String(v);
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-[13px] px-3.5 py-2 rounded-xl border whitespace-nowrap transition-colors ' +
        (active
          ? 'bg-brand text-white border-brand shadow-panel-sm font-medium'
          : 'bg-card text-ink border-border hover:border-brand-200')
      }
    >
      {children}
    </button>
  );
}

export default function DataRoomScreen({ source }: { source: DataRoomSourceKey }) {
  const { data: registry, isLoading: regLoading, isError: regError } = useDataRoomRegistry();
  const { data: me } = useMe();
  const { scope, win } = useScopePeriod();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pii, setPii] = useState(false);

  const src = registry?.sources.find((s) => s.key === source);
  const datasets = src?.datasets ?? [];
  const requested = params.get('dataset');
  const active = datasets.find((d) => d.key === requested) ?? datasets[0] ?? null;

  // Keep ?dataset= in the URL so a link to a specific pill is shareable.
  useEffect(() => {
    if (active && requested !== active.key) {
      const sp = new URLSearchParams(params.toString());
      sp.set('dataset', active.key);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }
  }, [active, requested, params, pathname, router]);

  const isOwner = me?.role === 'owner';
  const hasPii = !!active?.columns.some((c) => c.pii);
  const includePii = isOwner && pii;

  const queryParams = useMemo(
    () => ({
      scope,
      since: active?.roster ? undefined : win.since,
      until: active?.roster ? undefined : win.until,
      pii: includePii,
    }),
    [scope, win.since, win.until, active?.roster, includePii],
  );

  const page = useDataRoomPage(source, active?.key ?? null, queryParams);
  const rows: DataRoomRow[] = useMemo(() => page.data?.pages.flatMap((p) => p.rows) ?? [], [page.data]);
  const total = page.data?.pages[0]?.total ?? 0;

  const columns: Column<DataRoomRow>[] = useMemo(() => {
    if (!active) return [];
    return active.columns
      .filter((c) => includePii || !c.pii)
      .map((c) => ({
        header: c.col,
        align: c.col.endsWith('_pence') ? 'right' : 'left',
        render: (row: DataRoomRow) => <span className="whitespace-nowrap">{formatCell(c.col, row[c.col])}</span>,
      }));
  }, [active, includePii]);

  if (regLoading) {
    return (
      <div>
        <PageHeader title={`Data Room · ${source}`} />
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }
  if (regError || !src) {
    return (
      <div>
        <PageHeader title="Data Room" />
        <AlertRow tone="bad" title="Could not load the Data Room" body="Refresh the page. If it persists, contact the practice owner." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`Data Room · ${src.label}`} subtitle={src.description} />

      <ScopePeriodBar hidePeriod={!!active?.roster} />

      {/* Dataset pills */}
      <div className="flex gap-2 flex-wrap items-center mb-4">
        {datasets.map((d) => (
          <Pill
            key={d.key}
            active={active?.key === d.key}
            onClick={() => {
              const sp = new URLSearchParams(params.toString());
              sp.set('dataset', d.key);
              router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
            }}
          >
            {d.label}
          </Pill>
        ))}
      </div>

      {active && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-[13px] text-ink-muted">
              {page.isLoading ? 'Counting…' : `${total.toLocaleString('en-GB')} rows`}
              {active.roster ? ' · current list (no date filter)' : ` · ${win.label}`}
            </span>
            {isOwner && hasPii && (
              <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
                <input type="checkbox" checked={pii} onChange={(e) => setPii(e.target.checked)} />
                Include patient PII
              </label>
            )}
            {!isOwner && hasPii && (
              <span className="text-[12px] text-ink-muted">Patient identifiers are withheld — rows join on contact and PMS ids.</span>
            )}
            <a
              href={dataRoomExportUrl(source, active.key, queryParams)}
              download
              className="ml-auto inline-flex items-center rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-white shadow-panel-sm hover:bg-brand-700"
            >
              Export CSV
            </a>
          </div>

          {page.isLoading ? (
            <SkeletonTable rows={8} cols={Math.min(columns.length, 8)} />
          ) : page.isError ? (
            <AlertRow tone="bad" title="Could not load rows" body={(page.error as Error)?.message || 'Try again.'} />
          ) : rows.length === 0 ? (
            <EmptyState message={`No ${active.label.toLowerCase()} for this practice${active.roster ? '' : ' and period'}.`} />
          ) : (
            <div className="overflow-x-auto">
              <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id ?? `${r.pipeline_id}-${r.stage_id}`)} />
            </div>
          )}

          {page.hasNextPage && (
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => page.fetchNextPage()}
                disabled={page.isFetchingNextPage}
                className="rounded-xl border border-border bg-card px-4 py-2 text-[13px] text-ink hover:border-brand-200 disabled:opacity-60"
              >
                {page.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
              <span className="text-[12px] text-ink-muted">
                Showing {rows.length.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
