'use client';
import { useState } from 'react';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { useContacts } from '../hooks';
import PracticeTabs from '@/features/practices/PracticeTabs';

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

export default function ContactsScreen() {
  const [search, setSearch] = useState('');
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const { data } = useContacts(search, practiceId, source);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Contacts" subtitle="All leads, patients, lapsed" />
      <PracticeTabs value={practiceId} onChange={setPracticeId} />

      {/* Source tabs — view the Dentally-synced and GHL-synced books separately. */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {SOURCE_TABS.map((t) => {
          const active = source === t.key;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => setSource(t.key)}
              className={
                active
                  ? 'rounded-lg px-4 py-2 text-sm font-semibold bg-[#0E7C7B] text-white'
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
        onChange={(e) => setSearch(e.target.value)}
        className="input w-full mb-4 max-w-md"
      />
      <DataTable columns={columns} rows={data?.contacts} rowKey={(c) => c.id} />
    </div>
  );
}
