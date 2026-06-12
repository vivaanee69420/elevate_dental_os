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
    `rounded-full px-3 py-1 text-[13px] transition ${
      active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={chip(selected === null)} onClick={() => onSelect(null)}>All subaccounts</button>
      {accounts
        .filter((a) => a.accountId)
        .map((a) => (
          <button key={a.accountId} className={chip(selected === a.accountId)} onClick={() => onSelect(a.accountId)}>
            {a.label}
          </button>
        ))}
    </div>
  );
}
