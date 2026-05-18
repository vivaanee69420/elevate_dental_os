'use client';
import { useState } from 'react';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { useContacts } from '../hooks';

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
];

export default function ContactsScreen() {
  const [search, setSearch] = useState('');
  const { data } = useContacts(search);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Contacts" subtitle="All leads, patients, lapsed" />
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
