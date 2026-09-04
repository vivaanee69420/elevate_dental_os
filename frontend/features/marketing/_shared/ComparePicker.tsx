'use client';
// The "Compare" button and the panel it opens: off by default, and when on,
// either the equal-length period immediately before the selected one or a
// custom range the user types.
//
// DELIBERATELY NOT OFFERING "same period last year". It reads as the obvious
// third preset, and on this page it would quietly lie: ad_metrics holds
// roughly 15 months, so a last-year window frequently has no spend rows at
// all, and the cards would report a confident "▲ new" against a period that
// simply is not stored. A comparison the data cannot support is worse than no
// preset. If the retention changes, this is the place to add it.
//
// The comparison window is LOCAL state, not a URL parameter, unlike this
// page's tab and filter chips. Those identify what is being looked at and are
// worth sharing; a comparison is a transient question asked of it, and putting
// it in the URL would mean validating and clearing it on every tab change the
// way FILTER_PARAM already has to be.
import { useState } from 'react';
import { previousPeriod, inclusiveDays } from './compare';

export interface CompareWindow {
  since: string;
  until: string;
}

const INPUT = 'rounded-panel border border-border bg-white px-2 py-1 text-[12.5px] text-ink';

export function ComparePicker({
  since, until, value, onChange,
}: {
  /** The selected period, plain YYYY-MM-DD, both ends inclusive. */
  since: string;
  until: string;
  /** null = comparison off. */
  value: CompareWindow | null;
  onChange: (next: CompareWindow | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CompareWindow>(() => previousPeriod(since, until));

  const prev = previousPeriod(since, until);
  const days = inclusiveDays(since, until);

  // An inverted range matches nothing and would come back as an empty period
  // — indistinguishable, on the card, from a real period in which nothing
  // happened. Refused here rather than sent. (The backend's own since<=until
  // refine exists for the same reason; this keeps the user from having to
  // discover it as a failed request.)
  const invalid = draft.since > draft.until;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`rounded-panel border px-3 py-1.5 text-[12.5px] transition ${
          value ? 'border-brand text-brand' : 'border-border text-ink hover:border-brand'
        }`}
      >
        {value ? `Comparing: ${value.since} → ${value.until}` : 'Compare'}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[320px] rounded-panel border border-border bg-white p-3 shadow-lg">
          <p className="text-[12.5px] font-medium text-ink">Compare against</p>

          <button
            type="button"
            onClick={() => { onChange(prev); setDraft(prev); setOpen(false); }}
            className="mt-2 w-full rounded-panel border border-border px-2 py-2 text-left text-[12.5px] text-ink hover:border-brand"
          >
            Previous {days} days
            <span className="block text-[11.5px] text-ink-muted">{prev.since} → {prev.until}</span>
          </button>

          <p className="mt-3 text-[12px] font-medium text-ink">Custom range</p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="date" className={INPUT} value={draft.since}
              onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))}
              aria-label="Comparison start date"
            />
            <span className="text-[12px] text-ink-muted">to</span>
            <input
              type="date" className={INPUT} value={draft.until}
              onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))}
              aria-label="Comparison end date"
            />
          </div>
          {invalid && (
            <p className="mt-1 text-[11.5px] text-red-700">
              The start date must not be after the end date.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={invalid}
              onClick={() => { onChange(draft); setOpen(false); }}
              className="rounded-panel bg-brand px-3 py-1.5 text-[12.5px] text-white disabled:opacity-40"
            >
              Apply
            </button>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="text-[12.5px] text-ink-muted hover:underline"
              >
                Turn comparison off
              </button>
            )}
          </div>

          {/* The periods may overlap if the user asks for that; it is a
              legitimate question ("this month vs the quarter"). Said out loud
              so an accidental overlap is noticed rather than silently
              producing a delta of a period against part of itself. */}
          {value && value.until >= since && value.since <= until && (
            <p className="mt-2 text-[11.5px] text-ink-muted">
              This comparison overlaps the selected period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
