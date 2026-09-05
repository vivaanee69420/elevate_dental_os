'use client';
// ============================================================================
// The summary figures at the top of a report, as ONE rail rather than a row of
// boxes.
//
// The four-card grid it replaces is the single most template-looking thing on
// these pages: four identical rounded panels, four identical borders, four
// identical shadows, competing with each other and with every other panel
// below them. Cards are for things you can click or reorder. These are the
// four numbers a report opens with — they belong together, in one plate, read
// left to right like the head of a printed statement.
//
// So: one surface, hairline dividers between cells, label above value, a
// context line below. The value is set in the display serif because it is the
// only thing on the page that should be read at arm's length; everything else
// stays in the UI sans.
//
// On narrow screens the dividers move from vertical to horizontal rather than
// the cells stacking into four separate boxes again — the point is that they
// are one object.
// ============================================================================
import type { ReactNode } from 'react';

export interface Stat {
  label: string;
  /** Pre-formatted. This component never formats — see ./format.ts for why
   *  that contract lives in exactly one place. */
  value: ReactNode;
  /** Small line under the value: the denominator, the caveat, the comparison. */
  sub?: ReactNode;
  /** Rendered to the right of the label — a delta badge, usually. */
  badge?: ReactNode;
  /** Emphasises one cell. Used for money collected, which is the figure the
   *  whole report exists to produce and should not sit at the same weight as
   *  the cost inputs beside it. */
  accent?: boolean;
  /** When given the cell becomes a button — used to drill into the leads
   *  behind a figure. `active` shows which one is currently open. */
  onClick?: () => void;
  active?: boolean;
}

// Tailwind cannot see a class name built by interpolation, so the column
// counts are written out. Only the two this app actually uses.
const COLS: Record<number, string> = {
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

export function StatRail({ stats }: { stats: Stat[] }) {
  const cols = COLS[stats.length] ?? 'lg:grid-cols-4';
  return (
    <div className="rounded-panel border border-border bg-surface shadow-panel-sm">
      <div className={`grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:divide-y-0 ${cols}`}>
        {stats.map((s) => {
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {s.label}
                </span>
                {s.badge}
              </div>
              <div
                className={`mt-1.5 font-display text-[26px] leading-none ${
                  s.accent ? 'text-brand-700' : 'text-ink'
                }`}
              >
                {s.value}
              </div>
              {s.sub && <div className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">{s.sub}</div>}
            </>
          );
          if (!s.onClick) return <div key={s.label} className="px-5 py-4">{body}</div>;
          return (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              aria-expanded={Boolean(s.active)}
              // The open cell is marked by an inset ring rather than a border
              // change, so opening one does not shift the rail's own hairlines
              // and nudge every other cell by a pixel.
              className={`px-5 py-4 text-left transition-colors hover:bg-brand-50/50 ${
                s.active ? 'bg-brand-50/70 ring-1 ring-inset ring-brand-200' : ''
              }`}
            >
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A quiet, factual line of prose. The report is full of caveats that MUST be
 * stated — a clamped window, an approximate ratio, a coverage gap — and every
 * one of them used to get its own bordered, filled box, so a page with three
 * caveats looked like a page with three warnings.
 *
 * These are not warnings. They are footnotes. So: no border, no fill, a
 * hairline rule on the left, muted ink. Present, readable, and not shouting.
 */
export function FootNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-border py-0.5 pl-3 text-[12px] leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

/**
 * A section heading inside a report — above a table, under the tabs.
 *
 * Carries an optional right-hand slot for a toggle or a count, so a table's
 * controls sit ON its heading rather than in a separate bar above it.
 */
export function SectionHead({
  title, note, right,
}: { title: string; note?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[17px] leading-tight text-ink">{title}</h2>
        {note && <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-muted">{note}</p>}
      </div>
      {right}
    </div>
  );
}
