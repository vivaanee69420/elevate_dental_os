'use client';

// AdAccountFilter — dynamic, data-driven ad-account filter shared by the
// Marketing & ROI screen and the Business Hub marketing snapshot. Facebook
// (Meta) and Google get their own labelled rows, each selecting independently —
// pick one of each to compare a Facebook account against a Google account side
// by side, or one alone to see it separately. "All accounts" on a row clears
// just that provider. The pills are built from REAL connected ad accounts
// (useAdAccounts) — nothing is hardcoded. Each row hides when its provider has
// nothing to filter; the whole block hides when there's fewer than two accounts
// total. Owner-only endpoints — non-owners just don't get the rows.

import { useAdAccounts } from '@/features/integrations/hooks';
import type { AdAccount } from '@/features/integrations/api';

export function AdAccountFilter({
  metaId,
  googleId,
  onSelectMeta,
  onSelectGoogle,
}: {
  metaId: string | null;
  googleId: string | null;
  onSelectMeta: (id: string | null) => void;
  onSelectGoogle: (id: string | null) => void;
}) {
  const meta = useAdAccounts('meta_ads');
  const google = useAdAccounts('google_ads');
  const metaAccounts = (meta.data ?? []).filter((a) => a.is_selected);
  const googleAccounts = (google.data ?? []).filter((a) => a.is_selected);
  if (metaAccounts.length + googleAccounts.length < 2) return null;

  return (
    <div className="flex flex-col gap-2 -mt-1">
      <AdAccountRow label="Facebook" accounts={metaAccounts} selected={metaId} onSelect={onSelectMeta} />
      <AdAccountRow label="Google" accounts={googleAccounts} selected={googleId} onSelect={onSelectGoogle} />
    </div>
  );
}

// One labelled provider row. Renders nothing when the provider has no accounts.
// "All accounts" clears this provider's selection (null = every selected account
// for this provider).
function AdAccountRow({
  label,
  accounts,
  selected,
  onSelect,
}: {
  label: string;
  accounts: AdAccount[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <span className="text-[12px] text-ink-muted mr-0.5 w-[68px]">{label}</span>
      <FilterPill active={selected === null} onClick={() => onSelect(null)}>All accounts</FilterPill>
      {accounts.map((a) => (
        <FilterPill
          key={`${a.provider}-${a.customer_id}`}
          active={selected === a.customer_id}
          onClick={() => onSelect(a.customer_id)}
        >
          {a.name || a.customer_id}
        </FilterPill>
      ))}
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-[12px] px-3 py-1.5 rounded-xl border whitespace-nowrap transition-colors ' +
        (active
          ? 'bg-brand text-white border-brand shadow-panel-sm font-medium'
          : 'bg-card text-ink border-border hover:border-brand-200')
      }
    >
      {children}
    </button>
  );
}
