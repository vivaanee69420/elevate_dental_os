// HeatCell — one cell of the practice x treatment heat matrix.
// Accessibility (WCAG 1.4.1, task D3): value is NEVER colour-only. The cell
// always prints the formatted figure AND a non-colour cue (a bottom intensity
// bar), so colourblind / greyscale / sunlight users can still rank cells.
// Colour is reinforcement, not the sole channel.

interface HeatCellProps {
  /** Formatted value, e.g. "£12k". Empty/zero renders a muted dot. */
  value: string;
  /** Relative intensity 0-1 (cellValue / maxCell). Drives tint + bar width. */
  intensity: number;
  /** Optional rank (1 = biggest) shown as a superscript non-colour cue. */
  rank?: number;
}

/** Heat cell with £ value + non-colour intensity cue. Brand-green tint. */
export function HeatCell({ value, intensity, rank }: HeatCellProps) {
  const i = Math.max(0, Math.min(1, intensity));
  if (i <= 0) {
    return <td className="text-right p-2 text-ink-soft align-top">·</td>;
  }
  // Brand green #1D6E5F mixed onto white by intensity; text stays dark for contrast.
  const alpha = 0.1 + i * 0.5;
  return (
    <td className="text-right p-2 align-top tabular-nums" style={{ background: `rgba(29,110,95,${alpha})` }}>
      <span className="font-semibold text-ink">{value}</span>
      {rank != null && <sup className="ml-0.5 text-[9px] text-ink-muted">#{rank}</sup>}
      {/* non-colour cue: width encodes magnitude independent of hue */}
      <span aria-hidden="true" className="block mt-1 h-[3px] rounded bg-brand" style={{ width: `${Math.round(i * 100)}%` }} />
    </td>
  );
}
