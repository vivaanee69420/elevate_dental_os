'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function PaymentsPage() {
  const { data } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api('/api/payments'),
  });

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="display text-3xl font-bold">Patient Payments</h1>
      <p className="text-sm text-ink-muted mb-6">All transactions</p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Date</th>
              <th className="text-left p-3 font-semibold">Patient</th>
              <th className="text-left p-3 font-semibold">Description</th>
              <th className="text-right p-3 font-semibold">Amount</th>
              <th className="text-left p-3 font-semibold">Method</th>
              <th className="text-left p-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.payments?.map((p: any) => (
              <tr key={p.id} className="border-b border-border">
                <td className="p-3 text-ink-muted">{new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                <td className="p-3">{p.contact?.first_name} {p.contact?.last_name}</td>
                <td className="p-3 text-ink-muted">{p.description}</td>
                <td className="p-3 text-right font-semibold">£{((p.amount_pence || 0) / 100).toLocaleString()}</td>
                <td className="p-3 text-ink-muted">{p.method}</td>
                <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${p.status === 'settled' ? 'bg-green-50 text-success' : 'bg-bg'}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
