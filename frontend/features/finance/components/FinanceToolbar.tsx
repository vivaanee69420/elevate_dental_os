'use client';
// Shared toolbar for every finance tab. "+ Add payment" opens manual modal;
// SourceBreakdownCard shows where this tab's data came from. Same modal +
// breakdown component, dropped into every screen — keeps the four tabs in
// lock-step without duplicating logic.

import { useState } from 'react';
import { usePractices } from '@/features/integrations/hooks';
import ManualPaymentModal from './ManualPaymentModal';
import SourceBreakdownCard from './SourceBreakdownCard';

export default function FinanceToolbar() {
  const [showModal, setShowModal] = useState(false);
  // The shared cached query, not a private fetch. This used to load practices
  // in a useEffect whose .catch collapsed a FAILED request into an empty
  // array — so a backend hiccup was indistinguishable from "this org has no
  // practices", and the button silently disabled itself with no explanation.
  const { data, isPending, isError } = usePractices();
  const practices = data?.practices ?? [];

  // Three states, not two: still loading, genuinely failed, and genuinely
  // empty. Only the last is a reason to say the org has no practices.
  const disabled = isPending || isError || practices.length === 0;
  const title = isPending
    ? 'Loading practices…'
    : isError
      ? 'Could not load practices — reload to try again'
      : practices.length === 0
        ? 'No practices set up yet'
        : undefined;

  return (
    <>
      <div className="flex items-center" style={{ justifyContent: 'flex-end', gap: 10, marginBottom: 10 }}>
        {isError && (
          <span style={{ fontSize: 12, color: 'var(--danger)' }}>
            Could not load practices.
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={disabled}
          title={title}
          className="font-semibold"
          style={{
            padding: '8px 14px', fontSize: 13,
            border: 'none', borderRadius: 6,
            background: 'var(--brand)', color: 'white',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'default' : 'pointer',
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
