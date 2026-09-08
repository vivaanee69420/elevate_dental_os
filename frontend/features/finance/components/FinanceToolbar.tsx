'use client';
// Shared toolbar for every finance tab. "+ Add payment" opens manual modal;
// SourceBreakdownCard shows where this tab's data came from. Same modal +
// breakdown component, dropped into every screen — keeps the four tabs in
// lock-step without duplicating logic.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ManualPaymentModal from './ManualPaymentModal';
import SourceBreakdownCard from './SourceBreakdownCard';

export default function FinanceToolbar({ sourceDays = 30 }: {
  /**
   * The window the PAGE is actually showing. It was hardcoded to 30, so a
   * screen displaying "Last 12mo" carried a provenance panel headed "last 30
   * days" directly beneath the period control — two windows on one screen,
   * contradicting each other.
   */
  sourceDays?: number;
} = {}) {
  const [showModal, setShowModal] = useState(false);
  const [practices, setPractices] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    api<{ practices: Array<{ id: string; name: string }> }>('/api/practices')
      .then((r) => setPractices(r.practices ?? []))
      .catch(() => setPractices([]));
  }, []);

  return (
    <>
      {/* ONE row, not two. The button used to sit alone on its own full-width
          row above the panel, right-aligned against nothing — a floating
          action with no relationship to what was under it. All four finance
          screens render this, so all four gained a wasted row. */}
      <div className="flex items-start gap-3" style={{ marginBottom: 14 }}>
        <div className="flex-1 min-w-0">
          <SourceBreakdownCard days={sourceDays} />
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={practices.length === 0}
          className="font-semibold"
          style={{
            padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap',
            border: '1px solid var(--border)', borderRadius: 6,
            background: 'white', color: 'var(--ink)',
            opacity: practices.length === 0 ? 0.5 : 1,
            cursor: practices.length === 0 ? 'default' : 'pointer',
          }}
        >+ Add payment</button>
      </div>
      <ManualPaymentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        practices={practices}
      />
    </>
  );
}
