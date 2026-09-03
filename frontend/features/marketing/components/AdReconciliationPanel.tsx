'use client';
// Ads deep-grain reconciliation — the owner's stated acceptance criterion,
// "when I tally the data in our app and in the Google Ads account it should
// match exactly, without any duplication and data multiplication" (and the
// same for Meta), made into a product surface: a divergence is seen here
// rather than discovered in a client conversation.
//
// The Google KEYWORD shortfall is EXPECTED, not a defect — Dynamic Search Ads
// traffic carries no keyword and Display/Video campaigns have none at all, so
// keyword cost is always a subset of campaign cost, and Google's own interface
// shows the same gap. It is rendered as calm prose below the table, never in
// an error/warning colour. Any OTHER level failing to reconcile (ad groups/ads
// for Google, ad sets/ads for Meta) IS a genuine discrepancy and reads as one.
// See backend/src/services/ad-reconciliation.service.js and docs/API.md
// "Marketing reconciliation" for the contract this renders.
import { formatPence, formatDate } from '@/lib/format';
import { useAdReconciliation } from '../hooks';
import type { ReconciliationLevel } from '../api';

const PROVIDER_LABEL: Record<'google_ads' | 'meta_ads', string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
};

// The one grain where falling short of the campaign total is expected rather
// than a fault (see LEVELS in ad-reconciliation.service.js). Keyed off the
// stable grain id, not the note copy, so a wording change on the backend
// can't silently flip this row from calm to alarming or back.
const EXPECTED_SHORTFALL_GRAIN = 'google_keyword';

function LevelRow({ level }: { level: ReconciliationLevel }) {
  const reconciles = level.gapPence === 0;
  const isExpectedShortfall = level.grain === EXPECTED_SHORTFALL_GRAIN;
  // Reconciled = success. A genuine mismatch = a problem, in the danger
  // colour. The expected keyword shortfall is neither — it is calm fact,
  // rendered in the ordinary ink colour, never error/warning red or amber.
  const diffTone = reconciles ? 'text-success' : isExpectedShortfall ? 'text-ink' : 'text-danger';

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5 text-ink">{level.label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatPence(level.spendPence)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
        {formatPence(level.campaignSpendPence)}
      </td>
      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${diffTone}`}>
        {reconciles ? 'Reconciles' : (
          <>
            {formatPence(level.gapPence)}
            {/* null, not "0%" or "NaN%", when there is no campaign spend to
                divide by — a percentage of nothing is unknowable, not zero. */}
            {level.gapPct !== null && (
              <span className="ml-1 font-normal text-ink-muted">
                (
                {level.gapPct.toFixed(1)}
                %)
              </span>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const style = tone === 'warn'
    ? 'border-warning/30 bg-[#FDF3E4] text-[#78350F]'
    : 'border-border bg-bg text-ink-muted';
  return (
    <div className={`mt-3 rounded-panel border px-3 py-2 text-[12.5px] leading-relaxed ${style}`}>
      {children}
    </div>
  );
}

export function AdReconciliationPanel({
  provider, since, until,
}: { provider: 'google_ads' | 'meta_ads'; since: string; until: string }) {
  const { data, isLoading, isError, error } = useAdReconciliation(provider, since, until);
  const providerLabel = PROVIDER_LABEL[provider];

  if (isLoading) {
    return (
      <div className="rounded-panel border border-border bg-surface p-4">
        <h3 className="text-[14px] font-medium text-ink">{providerLabel} totals</h3>
        <p className="mt-2 text-[13px] text-ink-muted">Checking totals…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-panel border border-border bg-surface p-4">
        <h3 className="text-[14px] font-medium text-ink">{providerLabel} totals</h3>
        <p className="mt-2 text-[13px] text-ink-muted">
          Could not check totals:
          {' '}
          {(error as Error)?.message ?? 'unknown error'}
        </p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <section className="rounded-panel border border-border bg-surface p-4">
      <h3 className="text-[14px] font-medium text-ink">{providerLabel} totals</h3>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Our own totals against
        {' '}
        {providerLabel}
        &apos;s campaign figure,
        {' '}
        {formatDate(data.since)}
        {' '}
        to
        {' '}
        {formatDate(data.until)}
        .
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-bg">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-ink-muted">Level</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Our total</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Campaign total</th>
              <th className="px-4 py-2 text-right font-medium text-ink-muted">Difference</th>
            </tr>
          </thead>
          <tbody>
            {data.levels.map((l) => <LevelRow key={l.grain} level={l} />)}
          </tbody>
        </table>
      </div>

      {/* Expected shortfalls are explained calmly; a genuine mismatch is
          flagged as one. Both come from the server's own `note` field, so
          this panel never has to re-derive what counts as expected. */}
      {data.levels.filter((l) => l.note).map((l) => (
        <Note key={l.grain} tone={l.grain === EXPECTED_SHORTFALL_GRAIN ? 'info' : 'warn'}>
          <span className="font-medium">
            {l.label}
            :
            {' '}
          </span>
          {l.note}
        </Note>
      ))}

      {data.reachNote && <Note tone="info">{data.reachNote}</Note>}
    </section>
  );
}
