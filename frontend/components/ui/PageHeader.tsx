export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="display text-3xl font-bold">{title}</h1>
      {subtitle && <p className="text-sm text-ink-muted mt-1">{subtitle}</p>}
    </div>
  );
}
