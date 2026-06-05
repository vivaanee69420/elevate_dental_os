'use client';
// Manual P&L entry — owner types real monthly actuals per period + bucket.
// source='manual' is stamped server-side; rows land in monthly_financials and
// surface on /profit + /financial. Xero overrides manual for the same
// period+bucket, so connecting Xero later supersedes anything entered here.

import { useEffect, useState } from 'react';
import {
  useRecordMonthlyFinancial,
  useMonthlyFinancials,
  useDeleteMonthlyFinancial,
} from '../hooks';
import {
  DENTAL_BUCKET_LABELS,
  type DentalBucket,
} from '../api';
import { usePractices } from '@/features/practices/hooks';

const BUCKETS = Object.keys(DENTAL_BUCKET_LABELS) as DentalBucket[];

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: 8, border: '1px solid var(--border)',
  borderRadius: 6, marginBottom: 10, fontSize: 13,
};

interface Props {
  open: boolean;
  onClose: () => void;
  practiceId?: string | null;
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export default function ManualPLModal({ open, onClose, practiceId = null }: Props) {
  const record = useRecordMonthlyFinancial();
  const remove = useDeleteMonthlyFinancial();
  const { data: practiceData } = usePractices();
  const practices: { id: string; name: string }[] = practiceData?.practices ?? [];
  const [period, setPeriod] = useState(thisMonth());
  const [bucket, setBucket] = useState<DentalBucket>('revenue');
  const [amount, setAmount] = useState(''); // pounds, converted to pence
  // Seed the practice from the screen's active tab; re-sync if the tab changes
  // while the modal stays mounted. '' = Whole group / unassigned.
  const [practice, setPractice] = useState<string>(practiceId ?? '');
  useEffect(() => { setPractice(practiceId ?? ''); }, [practiceId]);

  // Manual rows already entered for the selected period + practice (echo + delete).
  const { data } = useMonthlyFinancials({ from: period, to: period, practice_id: practice || null });
  const rows = (data?.rows ?? []).filter((r) => r.source === 'manual');

  if (!open) return null;

  async function submit() {
    const amountPence = Math.round(parseFloat(amount || '0') * 100);
    if (!period || !Number.isFinite(amountPence) || amountPence === 0) return;
    await record.mutateAsync({ period, dental_bucket: bucket, amount_pence: amountPence, practice_id: practice || null });
    setAmount('');
  }

  const fmtPounds = (pence: number) =>
    `£${(pence / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

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
        style={{ background: 'white', maxWidth: 520, width: '92%', maxHeight: '88vh', overflowY: 'auto' }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          Enter P&amp;L actuals
        </h3>
        <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Real monthly figures for groups not on Xero. Entered per month and
          category. If you connect Xero later, its figures override these for the
          same month and category.
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Month</label>
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          style={fieldStyle}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Category</label>
        <select value={bucket} onChange={(e) => setBucket(e.target.value as DentalBucket)} style={fieldStyle}>
          {BUCKETS.map((b) => (
            <option key={b} value={b}>{DENTAL_BUCKET_LABELS[b]}</option>
          ))}
        </select>

        {practices.length > 1 && (
          <>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Practice</label>
            <select value={practice} onChange={(e) => setPractice(e.target.value)} style={fieldStyle}>
              <option value="">Whole group / unassigned</option>
              {practices.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
          </>
        )}

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Amount (£)</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={fieldStyle}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer' }}
          >Close</button>
          <button
            onClick={submit}
            disabled={!amount || record.isPending}
            style={{ padding: '8px 14px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >{record.isPending ? 'Saving…' : 'Add line'}</button>
        </div>

        {rows.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 10 }}>
            <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              Entered for {period}
            </div>
            <table className="w-full" style={{ fontSize: 12 }}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px' }}>{DENTAL_BUCKET_LABELS[r.dental_bucket]}</td>
                    <td className="text-right" style={{ padding: '6px 4px' }}>{fmtPounds(r.amount_pence)}</td>
                    <td className="text-right" style={{ padding: '6px 4px', width: 28 }}>
                      <button
                        onClick={() => remove.mutate(r.id)}
                        title="Remove"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, lineHeight: 1 }}
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 12 }}>
          source = manual · re-entering the same month + category updates the figure
        </p>
      </div>
    </div>
  );
}
