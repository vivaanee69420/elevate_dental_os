// BarRow — labelled horizontal bar: name (+ sub) | fill track | value (+ sub).
// Ports the prototype's `.barrow` used in Revenue-by-line, profit-per-case,
// lead funnel, and clinician production. For a bare bar, use ProgressBar.

interface BarRowProps {
  /** Left label. */
  name: string;
  /** Optional sub-label under the name (e.g. "12 cases · 48% margin"). */
  sub?: string;
  /** Fill width 0-100. */
  pct: number;
  /** Right-aligned value, e.g. "£12,400". */
  value: string;
  /** Optional sub under the value (e.g. "of group"). */
  valueSub?: string;
  /** Optional swatch dot colour (CSS colour) shown before the name. */
  dotColor?: string;
  /** Tailwind fill class; defaults to brand. */
  tone?: string;
}

/** One labelled bar row. Token-driven; see DESIGN.md. */
export function BarRow({ name, sub, pct, value, valueSub, dotColor, tone = 'bg-brand' }: BarRowProps) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-b-0">
      <div className="w-40 flex-none text-[13px] font-semibold">
        <span className="inline-flex items-center gap-2">
          {dotColor && (
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor }}
            />
          )}
          {name}
        </span>
        {sub && <span className="block text-[11px] font-normal text-ink-soft">{sub}</span>}
      </div>
      <div className="flex-1 h-6 min-w-[80px] rounded-lg bg-border overflow-hidden">
        <div className={`h-full rounded-lg ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div className="w-28 flex-none text-right text-[13px] font-bold">
        {value}
        {valueSub && <span className="block text-[11px] font-medium text-ink-soft">{valueSub}</span>}
      </div>
    </div>
  );
}
