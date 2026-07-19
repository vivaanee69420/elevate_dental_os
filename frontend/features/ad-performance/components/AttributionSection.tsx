'use client';
// Section 3 — how well leads tie back to accepted treatment.
//
// Emergent is NOT an advertising channel. It is the source of accepted
// treatment records that leads are matched against, which is what turns a lead
// into a conversion and gives it a value. So it belongs here, as a measure of
// downstream outcome and of match quality, rather than as a fourth column
// beside Google and Facebook.
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, Kpi, Explainer } from '@/components/ui';
import { matchStats } from '../derive';
import { pct, count } from '../format';
import type { AdLeadLine } from '../api';

// Must match the default `limit` fetchAdLeads (../api) sends the API when
// the caller doesn't specify one. When the lead list comes back at this cap,
// it may have been truncated, so match-value figures derived from it can be
// understated (and the "no lead" figure correspondingly overstated).
const LEAD_LIMIT = 500;

export function AttributionSection({
  lines,
  totalAcceptedPence,
  loading,
}: {
  lines: AdLeadLine[];
  totalAcceptedPence: number;
  loading: boolean;
}) {
  const st = matchStats(lines);
  const capped = lines.length >= LEAD_LIMIT;
  // Accepted value the group recorded that no tracked lead accounts for.
  // Clamped at zero: the lead list is capped at 500 rows, so on a large window
  // the matched sum can legitimately exceed nothing but never go negative.
  const unmatchedPence = Math.max(0, totalAcceptedPence - st.matchedValuePence);

  return (
    <SectionCard>
      <SecHead
        n={3}
        title="Attribution and match quality"
        desc="Emergent supplies accepted treatment records, not leads. A lead becomes a conversion when it matches one of those records, which is also where its value comes from. These figures show how much of that matching is actually landing."
      />
      {loading ? (
        <p className="text-sm text-slate-500">Loading attribution…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Kpi
            label="Leads matched to a treatment"
            value={count(st.matched)}
            note={`of ${count(st.total)} leads shown`}
            info={(
              <Explainer
                what="Leads that tie to an accepted treatment record in Emergent."
                how="Each lead is matched against accepted treatments in the same window on name and contact details."
                now={`${count(st.matched)} of ${count(st.total)}.`}
              />
            )}
          />
          <Kpi
            label="Match rate"
            value={pct(st.rate)}
            info={(
              <Explainer
                what="The share of leads that could be tied to an accepted treatment."
                how="Matched leads divided by total leads shown. A low rate means either that most enquiries have not accepted treatment yet, or that the records are not matching cleanly."
                now={pct(st.rate)}
              />
            )}
          />
          <Kpi
            label="Value from matched leads"
            value={formatPence(st.matchedValuePence)}
            info={(
              <Explainer
                what="Accepted treatment value that can be traced back to a specific lead."
                how="Summed across the matched leads in the list below."
                now={formatPence(st.matchedValuePence)}
              />
            )}
          />
          <Kpi
            label="Accepted value with no lead"
            value={formatPence(unmatchedPence)}
            valueMuted={unmatchedPence === 0}
            note={capped ? 'Upper bound — only the most recent 500 leads were matched.' : undefined}
            info={(
              <Explainer
                what="Treatment accepted in this window that no tracked lead accounts for."
                how="Group accepted value minus the value traced to matched leads. Usually walk-ins, referrals, returning patients, or enquiries that never reached a mapped pipeline."
                now={
                  (unmatchedPence === 0
                    ? 'Everything traced back to a lead.'
                    : `${formatPence(unmatchedPence)} untraced.`) +
                  (capped
                    ? ' Only the most recent 500 leads were checked, so some of this value may in fact belong to leads that were not loaded.'
                    : '')
                }
              />
            )}
          />
        </div>
      )}
    </SectionCard>
  );
}
