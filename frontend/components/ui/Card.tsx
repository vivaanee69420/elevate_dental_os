import { ReactNode } from 'react';

// `padded` mirrors the existing .card-padded utility; default is .card.
export function Card({
  children,
  padded = true,
  className = '',
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return <div className={`${padded ? 'card-padded' : 'card'} ${className}`.trim()}>{children}</div>;
}
