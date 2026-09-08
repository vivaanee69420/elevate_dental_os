'use client';
// Shared toolbar for every finance tab. "+ Add payment" opens manual modal;
// SourceBreakdownCard shows where this tab's data came from. Same modal +
// breakdown component, dropped into every screen — keeps the four tabs in
// lock-step without duplicating logic.

import { useState } from 'react';
import { usePractices } from '@/features/integrations/hooks';
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
      {/* ONE row, not two. The button used to sit alone on its own full-width
          row above the panel, right-aligned against nothing — a floating
          action with no relationship to what was under it. All four finance
          screens render this, so all four gained a wasted row. */}
      <div className="flex items-start gap-3" style={{ marginBottom: 14 }}>
        <div className="flex-1 min-w-0">
          <SourceBreakdownCard days={sourceDays} />
        </div>
        {/* A failed practices load is said out loud rather than left to read
            as "this org has no practices" — the button alone cannot tell the
            two apart. */}
        {isError && (
          <span style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'nowrap', alignSelf: 'center' }}>
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
            padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap',
            border: '1px solid var(--border)', borderRadius: 6,
            background: 'white', color: 'var(--ink)',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'default' : 'pointer',
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
