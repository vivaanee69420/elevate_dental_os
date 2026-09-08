'use client';
// Treatment Enquiries — live.
//
// This screen was 100% MOCK until now: buildEnquiries() over a hardcoded LEADS
// array in features/crm/data.ts, rendering invented patient names, treatments,
// values, payment plans and consultation dates to real tenants who had no way
// to tell it apart from the rest of the product.
//
// THREE COLUMNS THE MOCK HAD ARE GONE, because they have no honest source:
//
//   Treatment          The mock read leads.treatment. That is NOT a treatment:
//                      it is GoHighLevel's raw opportunity name, and on live
//                      data 3,201 of this group's leads carry a patient's
//                      email address or phone number in it. The honest source
//                      is Dentally's treatment-plan lines, which resolve for
//                      152 of 23,031 leads (0.7%) — a GHL lead and a Dentally
//                      patient are separate contact records. A column empty
//                      99.3% of the time is worse than no column.
//   Consultation date  leads.expected_close_date is 0% populated on BOTH
//                      organisations.
//   Payment plan       No source at all.
//
// What replaces them is the thing the data does support and nobody could see:
// how long each enquiry has been sitting there.

import { useEffect, useMemo, useState } from 'react';
import {
  Card, DataTable, EmptyState, KpiTile, PageHeader, Pagination, Skeleton,
  StatusBadge, type Column,
} from '@/components/ui';
import { useEnquiries } from '@/features/leads/hooks';
import type { Enquiry } from '@/features/leads/api';
import { money, DASH } from '@/features/marketing/_shared/format';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

// The server caps `limit` at 100, so the picker must not offer more — the
// shared DEFAULT_PAGE_SIZES ends at 250, which would 400 on selection.
const PAGE_SIZES = [25, 50, 100];
// An enquiry untouched for three weeks is the thing this page exists to find.
const STALE_DAYS = 21;

function fullName(e: Enquiry): string {
  const n = `${e.contact_first_name ?? ''} ${e.contact_last_name ?? ''}`.trim();
  return n || `Enquiry ${e.lead_id.slice(0, 8)}`;
}

function ageLabel(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 31) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

export default function EnquiriesScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [valuedOnly, setValuedOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  // Pagination is 1-indexed; the API takes an offset.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // The search runs in SQL over every enquiry, so it is debounced — each
  // keystroke is a real query, not a filter over an array already in memory.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any change to what is being asked for returns to page 1. Keeping the offset
  // lands the user on page 9 of a 2-page result, which reads as "no enquiries".
  useEffect(() => { setPage(1); }, [debounced, valuedOnly, openOnly, accountId, pageSize]);

  const { data, isLoading, error, isFetching } = useEnquiries({
    accountId,
    ...(debounced ? { search: debounced } : {}),
    valuedOnly,
    openOnly,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const rows = data?.enquiries ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary;

  const columns: Column<Enquiry>[] = useMemo(() => [
    { header: 'Name', render: (e) => <strong style={{ fontSize: 13 }}>{fullName(e)}</strong> },
    {
      header: 'Stage',
      render: (e) => (e.stage_name
        ? <StatusBadge tone="brand">{e.stage_name}</StatusBadge>
        : <span className="text-ink-muted">{e.status.replace(/_/g, ' ')}</span>),
    },
    {
      header: 'Value',
      // money() renders null as an em dash. lib/format's formatPence would
      // render it "£0.00" without a type error, which on the 77.5% of leads
      // that carry no value states a figure nobody recorded.
      render: (e) => money(e.estimated_value_pence),
    },
    { header: 'Source', render: (e) => <span className="text-ink-muted">{e.source || DASH}</span> },
    {
      header: 'Practice',
      // Rochester has practice_id on 0% of its leads, so this is blank for a
      // whole tenant. "Not mapped" says which of the two it is.
      render: (e) => (e.practice_name
        ? <span className="text-ink-muted">{e.practice_name}</span>
        : <span className="text-ink-muted" style={{ fontStyle: 'italic' }}>Not mapped</span>),
    },
    {
      header: 'Waiting',
      render: (e) => (
        <span style={{
          fontWeight: e.age_days >= STALE_DAYS ? 700 : 400,
          color: e.age_days >= STALE_DAYS ? 'var(--warning)' : 'var(--ink-muted)',
        }}>
          {ageLabel(e.age_days)}
        </span>
      ),
    },
  ], []);

  const stalePct = summary && summary.open_count > 0
    ? Math.round((summary.stale_count / summary.open_count) * 100)
    : null;

  return (
    <div className="mx-auto space-y-4" style={{ maxWidth: 1280 }}>
      <PageHeader
        title="Treatment enquiries"
        subtitle={isLoading || !summary
          ? 'Loading enquiries…'
          : `${summary.open_count.toLocaleString('en-GB')} open · `
            + `${total.toLocaleString('en-GB')} matching the current filters`}
      />

      {ghlData && ghlData.accounts.length > 0 && (
        <SubaccountFilterBar
          accounts={ghlData.accounts.map((a) => ({
            accountId: a.id,
            label: a.label || 'GoHighLevel',
            practiceId: a.practice_id ?? null,
          })) as any}
          selected={accountId}
          onSelect={setAccountId}
        />
      )}

      {error && (
        // A named failure, never a silent empty state. An endpoint that 404s
        // into "no enquiries" is indistinguishable from a practice with none.
        <div className="card" style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Could not load enquiries: {(error as Error).message}
        </div>
      )}

      {/* KpiTile is the section-wide headline primitive — same card, spacing
          and label treatment as every other screen in the product, rather than
          a fifth hand-rolled stat card. An undefined value renders an em dash,
          never a placeholder 0 that later becomes 17,778. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Open enquiries"
          value={summary?.open_count.toLocaleString('en-GB') ?? DASH}
          info="Leads not marked not-proceeding, treatment-completed or failed-to-attend. Counted in SQL over every lead, not the page on screen."
        />
        <KpiTile
          label="Value recorded"
          value={summary ? money(summary.value_pence) : DASH}
          // The count travels with the money. Without it a total reads as the
          // worth of every enquiry rather than of the minority carrying a
          // figure — here 2,772 of 17,778.
          delta={summary
            ? `on ${summary.valued_count.toLocaleString('en-GB')} of ${summary.open_count.toLocaleString('en-GB')}`
            : undefined}
          info="Sum of estimated value across open enquiries. Most enquiries carry no estimated value at all, so this is the total of the minority that do — never a valuation of the whole pipeline."
        />
        <KpiTile
          label={`Waiting ${STALE_DAYS}+ days`}
          value={summary?.stale_count.toLocaleString('en-GB') ?? DASH}
          delta={stalePct !== null ? `${stalePct}% of open enquiries` : undefined}
          deltaTone={stalePct !== null && stalePct >= 50 ? 'down' : 'muted'}
          info={`Open enquiries created ${STALE_DAYS} or more days ago, in London dates.`}
        />
        <KpiTile
          label="Longest wait"
          value={summary ? ageLabel(summary.oldest_age_days) : DASH}
          info="Age of the oldest enquiry still open."
        />
      </div>

      <Card>
        <div
          className="flex"
          style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, source or stage"
            aria-label="Search enquiries"
            style={{ flex: 1, minWidth: 220, padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <label className="text-ink-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={valuedOnly} onChange={(e) => setValuedOnly(e.target.checked)} />
            With a value only
          </label>
          <label className="text-ink-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>

        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              summary && summary.open_count === 0
                ? 'No enquiries yet — they appear here as leads arrive from GoHighLevel.'
                : debounced
                  ? `Nothing matches “${debounced}” across ${(summary?.open_count ?? 0).toLocaleString('en-GB')} enquiries.`
                  : 'No enquiries match these filters.'
            }
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(e) => e.lead_id} />
        )}

      </Card>

      {/* The shared pager: numbered pages, a size picker and "Showing a–b of
          N" — the same control the Data Room uses, rather than two bespoke
          Previous/Next buttons. The sizes stop at 100 because the endpoint
          rejects anything larger. */}
      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizes={PAGE_SIZES}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          isFetching={isFetching}
        />
      )}
    </div>
  );
}
