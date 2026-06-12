import type { GhlPerAccount } from '../api';

export function SubaccountFilterBar({
  accounts,
  selected,
  onSelect,
}: {
  accounts: GhlPerAccount[];
  selected: string | null; // accountId | null = All
  onSelect: (accountId: string | null) => void;
}) {
  const chip = (active: boolean) =>
    'text-[13px] px-3.5 py-2 rounded-xl border whitespace-nowrap transition-colors ' +
    (active
      ? 'bg-brand text-white border-brand shadow-panel-sm font-medium'
      : 'bg-card text-ink border-border hover:border-brand-200');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={chip(selected === null)} onClick={() => onSelect(null)}>All subaccounts</button>
      {accounts
        .filter((a) => a.accountId)
        .map((a) => (
          <button type="button" key={a.accountId} className={chip(selected === a.accountId)} onClick={() => onSelect(a.accountId)}>
            {a.label}
          </button>
        ))}
    </div>
  );
}
