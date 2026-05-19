// KpiTile — single headline metric card used across every section.
// Frozen Phase-0 primitive. `delta` slot added centrally after Wave 1
// agents repeatedly needed the prototype's sub-line; additive and
// backward-compatible (existing two-prop callers unaffected).

interface KpiTileProps {
  /** Uppercase metric label, e.g. "Monthly revenue". */
  label: string;
  /** Formatted metric value, e.g. "£412k". */
  value: string;
  /** Optional sub-line under the value (trend / context). */
  delta?: string;
  /** Tone for the delta text. Defaults to muted. */
  deltaTone?: 'up' | 'down' | 'muted';
}

/** Render one KPI card; shows the delta sub-line only when provided. */
export function KpiTile({ label, value, delta, deltaTone = 'muted' }: KpiTileProps) {
  const toneClass =
    deltaTone === 'up'
      ? 'text-success'
      : deltaTone === 'down'
      ? 'text-danger'
      : 'text-ink-muted';
  return (
    <div className="card-padded">
      <div className="text-xs text-ink-muted uppercase">{label}</div>
      <div className="display text-2xl font-bold mt-1">{value}</div>
      {delta && <div className={`text-xs mt-1 ${toneClass}`}>{delta}</div>}
    </div>
  );
}
