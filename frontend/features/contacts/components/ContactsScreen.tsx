'use client';
import { useState } from 'react';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { useContacts } from '../hooks';
import PracticeTabs from '@/features/practices/PracticeTabs';
import { useScopePeriod } from '@/features/_shared/scope-context';

// A real practice scope is a UUID; 'all' and any group sentinel ('practices',
// 'academy', 'lab') must NOT be sent as practice_id (the backend validates it as
// a uuid). Treat anything non-uuid as "no practice filter".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function scopeToPracticeId(scope: string): string | null {
  return scope !== 'all' && UUID_RE.test(scope) ? scope : null;
}

// Human label for the integration origin shown in the Source column / tabs.
const SOURCE_LABEL: Record<string, string> = {
  dentally: 'Dentally',
  gohighlevel: 'GoHighLevel',
  manual: 'Manual',
  csv: 'CSV',
};

// Contact source tabs. null = all contacts; the others filter by origin so the
// owner can view the Dentally-synced book and the GoHighLevel-synced book apart.
const SOURCE_TABS: { key: string | null; label: string }[] = [
  { key: null, label: 'All Contacts' },
  { key: 'dentally', label: 'Dentally Contacts' },
  { key: 'gohighlevel', label: 'GHL Contacts' },
];

const columns: Column<any>[] = [
  {
    header: 'Name',
    render: (c) => (
      <span className="font-semibold">
        {c.first_name} {c.last_name}
      </span>
    ),
  },
  { header: 'Type', render: (c) => <StatusBadge>{c.type}</StatusBadge> },
  { header: 'Email', render: (c) => <span className="text-ink-muted">{c.email}</span> },
  { header: 'Phone', render: (c) => <span className="text-ink-muted">{c.phone}</span> },
  { header: 'Practice', render: (c) => <span className="text-ink-muted">{c.practice?.name}</span> },
  { header: 'Source', render: (c) => <span className="text-ink-muted">{SOURCE_LABEL[c.source] ?? c.source ?? '—'}</span> },
];

const PAGE_SIZE = 50;

export default function ContactsScreen() {
  // The practice filter is the globally-selected practice (= GHL subaccount).
  // PracticeTabs writes through to the shared scope so the selection persists
  // across screens and the URL.
  const { scope, setScope } = useScopePeriod();
  const practiceId = scopeToPracticeId(scope);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { data } = useContacts(search, practiceId, source, page, PAGE_SIZE);

  // Any filter/search change resets to page 1.
  function changeSource(key: string | null) { setSource(key); setPage(1); }
  function changePractice(id: string | null) { setScope(id ?? 'all'); setPage(1); }
  function changeSearch(v: string) { setSearch(v); setPage(1); }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Contacts" subtitle="All leads, patients, lapsed" />
      <PracticeTabs value={practiceId} onChange={changePractice} />

      {/* Source tabs — view the Dentally-synced and GHL-synced books separately. */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {SOURCE_TABS.map((t) => {
          const active = source === t.key;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => changeSource(t.key)}
              className={
                active
                  ? 'rounded-lg px-4 py-2 text-sm font-semibold bg-[var(--brand)] text-white'
                  : 'rounded-lg px-4 py-2 text-sm font-semibold bg-white text-ink-muted border border-[var(--border)] hover:bg-slate-50'
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        placeholder="Search name, email, phone..."
        value={search}
        onChange={(e) => changeSearch(e.target.value)}
        className="input w-full mb-4 max-w-md"
      />
      <DataTable columns={columns} rows={data?.contacts} rowKey={(c) => c.id} />

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4" style={{ fontSize: 13 }}>
        <span className="text-ink-muted">
          {total === 0 ? 'No contacts' : `${from.toLocaleString('en-GB')}–${to.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md px-3 py-1.5 text-sm font-semibold border border-[var(--border)] bg-white disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-ink-muted">Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md px-3 py-1.5 text-sm font-semibold border border-[var(--border)] bg-white disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
