'use client';

// Data Room — one screen for every source. Practice pills + period (shared
// ScopePeriodBar, remembered across Data Room pages), a dataset pill row (from
// the API registry), a streamed CSV export, and a numbered-page table that
// scrolls horizontally when a dataset is wider than the viewport. PII columns
// never reach this screen unless the caller is an owner who switched
// "Include patient PII" on.
//
// URL state: ?dataset= (pill) · ?page= · ?per= (rows per page), plus the shared
// scope/period params — so any view is a shareable link.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useMe } from '@/hooks/useMe';
import {
  DataTable, EmptyState, PageHeader, AlertRow, SkeletonTable, Pagination, DEFAULT_PAGE_SIZES, type Column,
} from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useDataRoomFreshness, useDataRoomPage, useDataRoomRegistry } from '../hooks';
import { usePersistedScopePeriod } from '../use-persisted-period';
import { dataRoomExportUrl, type DataRoomRow, type DataRoomSourceKey } from '../api';
import DictionaryDrawer from './DictionaryDrawer';

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DEFAULT_PER = 100;

function formatCell(col: string, v: unknown, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if ((unit === 'pence' || col.endsWith('_pence')) && typeof v === 'number') return formatPence(v);
  if (unit === 'percent' && typeof v === 'number') return `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
  if (unit === 'minutes' && typeof v === 'number') return `${v} min`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && ISO_TS.test(v)) {
    return new Date(v).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  }
  return String(v);
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function parsePer(raw: string | null): number {
  const n = Number(raw);
  return DEFAULT_PAGE_SIZES.includes(n) ? n : DEFAULT_PER;
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
  usePersistedScopePeriod();
  const { data: registry, isLoading: regLoading, isError: regError } = useDataRoomRegistry();
  const { data: me } = useMe();
  const { data: fresh } = useDataRoomFreshness();
  const srcFresh = fresh?.sources[source];
  const asOf = srcFresh?.last_sync_at ?? fresh?.as_of ?? null;
  const { scope, win } = useScopePeriod();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pii, setPii] = useState(false);
  const [dict, setDict] = useState(false);

  const src = registry?.sources.find((s) => s.key === source);
  const datasets = src?.datasets ?? [];
  const requested = params.get('dataset');
  const active = datasets.find((d) => d.key === requested) ?? datasets[0] ?? null;
  const page = parsePage(params.get('page'));
  const per = parsePer(params.get('per'));

  // Patch URL search params in place; `null` deletes a key.
  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Keep ?dataset= in the URL so a link to a specific pill is shareable.
  useEffect(() => {
    if (active && requested !== active.key) patch({ dataset: active.key });
  }, [active, requested, patch]);

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

  // Any change to dataset / scope / period / PII / page size starts again at
  // page 1. The first resolved key is the baseline so a shared ?page=N link
  // survives the registry load.
  const filterKey = active ? [active.key, scope, queryParams.since ?? '', queryParams.until ?? '', includePii ? 1 : 0, per].join('|') : null;
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    if (filterKey === null) return;
    if (baseline.current === null) { baseline.current = filterKey; return; }
    if (baseline.current !== filterKey) {
      baseline.current = filterKey;
      if (page !== 1) patch({ page: null });
    }
  }, [filterKey, page, patch]);

  const q = useDataRoomPage(source, active?.key ?? null, queryParams, page, per);
  const rows: DataRoomRow[] = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / per));

  // Filters shrank the set below the current page — snap back to the last page.
  useEffect(() => {
    if (q.data && !q.isPlaceholderData && page > pageCount) patch({ page: pageCount === 1 ? null : String(pageCount) });
  }, [q.data, q.isPlaceholderData, page, pageCount, patch]);

  const columns: Column<DataRoomRow>[] = useMemo(() => {
    if (!active) return [];
    return active.columns
      .filter((c) => includePii || !c.pii)
      .map((c) => ({
        header: c.derived ? `${c.col} ·` : c.col,
        align: c.unit === 'pence' || c.unit === 'count' || c.unit === 'percent' || c.col.endsWith('_pence') ? 'right' : 'left',
        render: (row: DataRoomRow) => <span className="whitespace-nowrap">{formatCell(c.col, row[c.col], c.unit)}</span>,
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

      <ScopePeriodBar />

      {/* Dataset pills */}
      <div className="flex gap-2 flex-wrap items-center mb-4">
        {datasets.map((d) => (
          <Pill key={d.key} active={active?.key === d.key} onClick={() => patch({ dataset: d.key, page: null })}>
            {d.label}
          </Pill>
        ))}
      </div>

      {active && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-[13px] text-ink-muted">
              {q.isLoading ? 'Counting…' : `${total.toLocaleString('en-GB')} rows`}
              {active.roster ? ' · current list — not date-filtered' : ` · ${win.label}`}
            </span>
            <span
              className="text-[12px] px-2 py-0.5 rounded-lg border border-border bg-card text-ink-muted"
              title={srcFresh?.accounts?.length ? srcFresh.accounts.map((a) => `${a.label ?? 'account'}: ${a.last_sync_at ? new Date(a.last_sync_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'never'} (${a.status ?? 'unknown'})`).join('\n') : undefined}
            >
              {asOf ? `Data as of ${new Date(asOf).toLocaleString('en-GB', { timeZone: 'Europe/London' })}` : 'Not yet synced'}
              {srcFresh?.status === 'failed' ? ' · last sync failed' : ''}
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
            <button
              type="button"
              onClick={() => setDict(true)}
              className="text-[13px] px-3 py-1.5 rounded-xl border border-border bg-card text-ink hover:border-brand-200"
            >
              Dictionary
            </button>
            <div className="ml-auto inline-flex rounded-xl shadow-panel-sm overflow-hidden">
              <a
                href={dataRoomExportUrl(source, active.key, queryParams, 'csv')}
                download
                className="inline-flex items-center bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700 border-r border-white/20"
              >
                Export CSV
              </a>
              <a
                href={dataRoomExportUrl(source, active.key, queryParams, 'xlsx')}
                download
                title={queryParams.scope === 'all' ? 'One worksheet per practice' : 'One worksheet'}
                className="inline-flex items-center bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700"
              >
                Export Excel
              </a>
            </div>
          </div>

          {q.isLoading ? (
            <SkeletonTable rows={8} cols={Math.min(columns.length, 8)} />
          ) : q.isError ? (
            <AlertRow tone="bad" title="Could not load rows" body={(q.error as Error)?.message || 'Try again.'} />
          ) : total === 0 ? (
            <EmptyState message={`No ${active.label.toLowerCase()} for this practice${active.roster ? '' : ' and period'}.`} />
          ) : (
            <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={q.isPlaceholderData}>
              <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id ?? `${r.pipeline_id}-${r.stage_id}`)} />
            </div>
          )}

          {!q.isLoading && !q.isError && total > 0 && (
            <Pagination
              page={page}
              pageSize={per}
              total={total}
              isFetching={q.isFetching}
              onPageChange={(p) => patch({ page: p === 1 ? null : String(p) })}
              onPageSizeChange={(n) => patch({ per: n === DEFAULT_PER ? null : String(n), page: null })}
            />
          )}
        </>
      )}

      <DictionaryDrawer open={dict} dataset={active} sourceLabel={src.label} onClose={() => setDict(false)} />
    </div>
  );
}
