import { ReactNode } from 'react';

// icon is caller-supplied (kept as-is to preserve existing visuals).
export function EmptyState({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="p-12 text-center text-ink-muted">
      {icon && <div className="text-4xl mb-2">{icon}</div>}
      <p>{message}</p>
    </div>
  );
}
