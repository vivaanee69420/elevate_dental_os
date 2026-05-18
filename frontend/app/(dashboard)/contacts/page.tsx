'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => api(`/api/contacts?search=${encodeURIComponent(search)}&limit=200`),
  });

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="display text-3xl font-bold">Contacts</h1>
      <p className="text-sm text-ink-muted mb-4">All leads, patients, lapsed</p>

      <input
        type="text"
        placeholder="Search name, email, phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input w-full mb-4 max-w-md"
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold">Type</th>
              <th className="text-left p-3 font-semibold">Email</th>
              <th className="text-left p-3 font-semibold">Phone</th>
              <th className="text-left p-3 font-semibold">Practice</th>
            </tr>
          </thead>
          <tbody>
            {data?.contacts?.map((c: any) => (
              <tr key={c.id} className="border-b border-border hover:bg-bg">
                <td className="p-3 font-semibold">{c.first_name} {c.last_name}</td>
                <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-bg">{c.type}</span></td>
                <td className="p-3 text-ink-muted">{c.email}</td>
                <td className="p-3 text-ink-muted">{c.phone}</td>
                <td className="p-3 text-ink-muted">{c.practice?.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
