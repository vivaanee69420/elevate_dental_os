// Thin progress bar. `tone` overrides the fill colour; default brand.
export function ProgressBar({
  pct,
  tone = 'bg-brand',
}: {
  pct: number;
  tone?: string;
}) {
  return (
    <div className="h-2 bg-bg rounded-full overflow-hidden">
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Maps a 0-100 value to the success/warning/danger fill used in progress page.
export function progressTone(pct: number): string {
  return pct >= 70 ? 'bg-success' : pct >= 35 ? 'bg-warning' : 'bg-danger';
}
