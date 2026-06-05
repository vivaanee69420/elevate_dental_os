'use client';
// Manual payment entry modal. Owner types amount + method + practice; backend
// stamps source='manual' and lands the row in the same payments table the
// Stripe/Dentally syncs use. Same destination → next snapshot picks it up.

import { useState } from 'react';
import { useRecordManualPayment } from '../hooks';

const METHODS: Array<{ value: NonNullable<Parameters<typeof useRecordManualPayment>[never] extends never ? never : never>['method'] | string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'direct_debit', label: 'Direct debit' },
  { value: 'finance', label: 'Patient finance' },
  { value: 'pay_link', label: 'Pay link (manual)' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  practices: Array<{ id: string; name: string }>;
}

export default function ManualPaymentModal({ open, onClose, practices }: Props) {
  const mut = useRecordManualPayment();
  const [practiceId, setPracticeId] = useState(practices[0]?.id ?? '');
  const [amount, setAmount] = useState(''); // pounds, will convert to pence
  const [method, setMethod] = useState<string>('cash');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  if (!open) return null;

  async function submit() {
    const amountPence = Math.round(parseFloat(amount || '0') * 100);
    if (!practiceId || amountPence <= 0) return;
    await mut.mutateAsync({
      practice_id: practiceId,
      amount_pence: amountPence,
      method: method as any,
      status: 'settled',
      description: description || undefined,
      processed_at: new Date(`${date}T12:00:00Z`).toISOString(),
    });
    setAmount('');
    setDescription('');
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card-padded"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', maxWidth: 480, width: '90%' }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Record payment</h3>
        <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          For payments that did not come through Stripe or a connected app.
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Practice</label>
        <select
          value={practiceId}
          onChange={(e) => setPracticeId(e.target.value)}
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10, fontSize: 13 }}
        >
          {practices.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Amount (£)</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10, fontSize: 13 }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10, fontSize: 13 }}
        >
          {METHODS.map((m) => <option key={String(m.value)} value={String(m.value)}>{m.label}</option>)}
        </select>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10, fontSize: 13 }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Implant deposit · Mrs Smith"
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14, fontSize: 13 }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer' }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!practiceId || !amount || mut.isPending}
            style={{ padding: '8px 14px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >{mut.isPending ? 'Saving…' : 'Record payment'}</button>
        </div>
        <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 10 }}>
          source = manual · feeds next snapshot tick
        </p>
      </div>
    </div>
  );
}
