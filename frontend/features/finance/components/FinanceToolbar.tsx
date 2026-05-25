'use client';
// Shared toolbar for every finance tab. "+ Add payment" opens manual modal;
// SourceBreakdownCard shows where this tab's data came from. Same modal +
// breakdown component, dropped into every screen — keeps the four tabs in
// lock-step without duplicating logic.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ManualPaymentModal from './ManualPaymentModal';
import SourceBreakdownCard from './SourceBreakdownCard';

export default function FinanceToolbar() {
  const [showModal, setShowModal] = useState(false);
  const [practices, setPractices] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    api<{ practices: Array<{ id: string; name: string }> }>('/api/practices')
      .then((r) => setPractices(r.practices ?? []))
      .catch(() => setPractices([]));
  }, []);

  return (
    <>
      <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={practices.length === 0}
          className="font-semibold"
          style={{
            padding: '8px 14px', fontSize: 13,
            border: 'none', borderRadius: 6,
            background: '#0E7C7B', color: 'white',
            opacity: practices.length === 0 ? 0.5 : 1,
            cursor: practices.length === 0 ? 'default' : 'pointer',
          }}
        >+ Add payment</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <SourceBreakdownCard days={30} />
      </div>
      <ManualPaymentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        practices={practices}
      />
    </>
  );
}
