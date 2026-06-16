// Explainer — a plain-English "how is this calculated" panel used inside KPI
// cards and beside tables. Three short, labelled sections so a non-technical
// reader can follow: what the number means, how we work it out, and the live
// figures plugged in. `now` is optional (some metrics have no single number).

import type { ReactNode } from 'react';

export function Explainer({ what, how, now }: { what: ReactNode; how: ReactNode; now?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-[12px] leading-relaxed">
      <div>
        <div className="font-semibold text-ink">What this is</div>
        <div className="text-ink-muted mt-0.5">{what}</div>
      </div>
      <div>
        <div className="font-semibold text-ink">How we work it out</div>
        <div className="text-ink-muted mt-0.5">{how}</div>
      </div>
      {now && (
        <div>
          <div className="font-semibold text-ink">Your numbers right now</div>
          <div className="text-ink-muted mt-0.5">{now}</div>
        </div>
      )}
    </div>
  );
}
