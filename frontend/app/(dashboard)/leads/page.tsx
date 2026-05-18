'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function LeadsPage() {
  const { data } = useQuery({
    queryKey: ['leads'],
    queryFn: () => api('/api/leads?limit=100'),
  });

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="display text-3xl font-bold">Leads</h1>
      <p className="text-sm text-ink-muted mb-6">All enquiries across practices</p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold">Treatment</th>
              <th className="text-left p-3 font-semibold">Value</th>
              <th className="text-left p-3 font-semibold">Status</th>
              <th className="text-left p-3 font-semibold">Source</th>
              <th className="text-left p-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {data?.leads?.map((lead: any) => (
              <tr key={lead.id} className="border-b border-border hover:bg-bg">
                <td className="p-3">{lead.contact?.first_name} {lead.contact?.last_name}</td>
                <td className="p-3">{lead.treatment}</td>
                <td className="p-3">£{((lead.estimated_value_pence || 0) / 100).toLocaleString()}</td>
                <td className="p-3"><span className="px-2 py-1 rounded bg-brand-50 text-brand text-xs">{lead.status.replace(/_/g, ' ')}</span></td>
                <td className="p-3 text-ink-muted">{lead.source || '—'}</td>
                <td className="p-3 text-ink-muted">{new Date(lead.created_at).toLocaleDateString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!data?.leads || data.leads.length === 0) && (
          <div className="p-12 text-center text-ink-muted">
            <div className="text-4xl mb-2">📥</div>
            <p>No leads yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
