import { Card } from './Card';

// Light-only skeleton loaders. A faint tinted block on white surfaces with a
// soft pulse — matches the "no dark mode, light/white only" rule. Use while a
// live API query is in flight, in place of "Loading…" text.

export function Skeleton({
  className = '',
  rounded = 'rounded-md',
  style,
}: {
  className?: string;
  rounded?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse bg-[#EEF3EF] ${rounded} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    />
  );
}

// A run of text lines; last line is shorter to mimic a paragraph.
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

// One KPI tile placeholder: small label line + large value line.
export function SkeletonKpi({ className = '' }: { className?: string }) {
  return (
    <Card className={className}>
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-32" />
    </Card>
  );
}

// A row of KPI tile placeholders.
export function SkeletonKpiRow({
  count = 4,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-4 ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonKpi key={i} />
      ))}
    </div>
  );
}

// A chart-area placeholder inside a card.
export function SkeletonChart({
  height = 280,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  return (
    <Card className={className}>
      <Skeleton className="h-3 w-40 mb-4" />
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}

// A table placeholder: header strip + N body rows.
export function SkeletonTable({
  rows = 6,
  cols = 4,
  className = '',
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <Card className={className} padded={false}>
      <div className="p-4 space-y-3" aria-hidden="true">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-3/4" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
