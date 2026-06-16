'use client';

// SectionFilterPills — a compact, data-driven filter row shown directly above a
// single data-source section on the Business Hub (practices for Dentally,
// companies for QuickBooks, subaccounts for GoHighLevel). "All" clears the
// selection (null). Options are built from the source's REAL connected
// accounts/practices — the row hides itself when there's fewer than two options
// to choose between.

export type FilterOption = { id: string; label: string };

export function SectionFilterPills({
  label,
  options,
  selectedId,
  onSelect,
  allLabel = 'All',
}: {
  label: string;
  options: FilterOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  allLabel?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex gap-2 flex-wrap items-center mb-2">
      <span className="text-[12px] text-ink-muted mr-0.5">{label}</span>
      <Pill active={selectedId === null} onClick={() => onSelect(null)}>{allLabel}</Pill>
      {options.map((o) => (
        <Pill key={o.id} active={selectedId === o.id} onClick={() => onSelect(o.id)}>{o.label}</Pill>
      ))}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
