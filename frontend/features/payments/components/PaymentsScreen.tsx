'use client';
import { useMemo, useState } from 'react';
import { PageHeader, DataTable, StatusBadge, type Column } from '@/components/ui';
import { formatPence, formatDate } from '@/lib/format';
import { usePayments, useCreatePaymentLink } from '../hooks';

const columns: Column<any>[] = [
  { header: 'Date', render: (p) => <span className="text-ink-muted">{formatDate(p.created_at)}</span> },
  { header: 'Patient', render: (p) => `${p.contact?.first_name ?? ''} ${p.contact?.last_name ?? ''}` },
  { header: 'Description', render: (p) => <span className="text-ink-muted">{p.description}</span> },
  {
    header: 'Amount',
    align: 'right',
    render: (p) => <span className="font-semibold">{formatPence(p.amount_pence)}</span>,
  },
  { header: 'Method', render: (p) => <span className="text-ink-muted">{p.method}</span> },
  {
    header: 'Status',
    render: (p) => (
      <StatusBadge tone={p.status === 'settled' ? 'success' : 'neutral'}>{p.status}</StatusBadge>
    ),
  },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

export default function PaymentsScreen() {
  const { data } = usePayments();
  const createLink = useCreatePaymentLink();
  const payments: any[] = useMemo(() => data?.payments ?? [], [data]);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stats = useMemo(() => {
    const now = Date.now();
    const inWin = (iso: string, ms: number) =>
      iso && now - new Date(iso).getTime() <= ms;
    const settled = payments.filter((p) => p.status === 'settled');
    const sum = (a: any[]) => a.reduce((s, p) => s + (p.amount_pence || 0), 0);
    return {
      today: sum(settled.filter((p) => inWin(p.created_at, 86400000))),
      week: sum(settled.filter((p) => inWin(p.created_at, 7 * 86400000))),
      month: sum(settled.filter((p) => inWin(p.created_at, 30 * 86400000))),
      outstanding: sum(payments.filter((p) => p.status === 'pending')),
    };
  }, [payments]);

  async function submit() {
    setErr(null);
    setUrl(null);
    const pounds = parseFloat(amount);
    if (isNaN(pounds) || pounds <= 0) {
      setErr('Enter a valid amount.');
      return;
    }
    if (!desc.trim()) {
      setErr('Enter a description.');
      return;
    }
    try {
      const r: any = await createLink.mutateAsync({
        amount_pence: Math.round(pounds * 100),
        description: desc.trim(),
      });
      const link = r?.url ?? r?.paymentLink?.url ?? null;
      setUrl(link);
      if (!link) setErr('Link created but no URL returned.');
    } catch {
      setErr('Could not create link. Stripe may not be configured.');
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <PageHeader title="Patient Payments" subtitle="All transactions" />
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setUrl(null);
            setErr(null);
          }}
          className="btn btn-primary font-semibold"
          style={{ padding: '9px 16px', fontSize: 13 }}
        >
          Create payment link
        </button>
      </div>

      <div className="grid gap-4 my-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Today" value={formatPence(stats.today)} />
        <Stat label="This week" value={formatPence(stats.week)} />
        <Stat label="This month" value={formatPence(stats.month)} />
        <Stat label="Outstanding" value={formatPence(stats.outstanding)} />
      </div>

      <DataTable columns={columns} rows={payments} rowKey={(p) => p.id} />

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card-padded"
            style={{ background: 'white', width: 420, maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="display text-lg font-semibold mb-3">
              Create payment link
            </h2>
            <label className="block mb-3" style={{ fontSize: 13 }}>
              Amount (£)
              <input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                style={{ width: '100%', padding: '8px 10px', marginTop: 4 }}
              />
            </label>
            <label className="block mb-4" style={{ fontSize: 13 }}>
              Description
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="input"
                style={{ width: '100%', padding: '8px 10px', marginTop: 4 }}
              />
            </label>
            {err && (
              <div className="text-sm mb-3" style={{ color: 'var(--danger)' }}>
                {err}
              </div>
            )}
            {url && (
              <div
                className="bg-bg mb-3"
                style={{ padding: 10, borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}
              >
                {url}
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(url)}
                  className="font-semibold"
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    background: 'white',
                  }}
                >
                  Copy
                </button>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'white',
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={createLink.isPending}
                className="btn btn-primary font-semibold"
                style={{ padding: '8px 14px', fontSize: 13 }}
              >
                {createLink.isPending ? 'Creating…' : 'Generate link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
