// Why a marketing figure is missing, said out loud.
//
// £0.00 is ambiguous, and the ambiguity is not academic: this screen showed
// "Barnet — Ad spend £0.00" beside 315 leads while that practice's Meta account
// had £4,612.79 of spend that month. The stamping fix (migration 000140) means
// mapped accounts now report correctly, but an account nobody has mapped still
// produces £0 for every practice — and a number that reads as "we spent
// nothing" when the truth is "we cannot tell you" is worse than no number.
//
// Nothing renders when there is nothing to say.
import { formatPence } from '@/lib/format';
import type { MarketingCoverage } from '../api';

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const style = tone === 'warn'
    ? 'border-warning/30 bg-[#FDF3E4] text-[#78350F]'
    : 'border-border bg-surface text-ink-muted';
  return (
    <div className={`rounded-panel border px-4 py-3 text-[13px] leading-relaxed ${style}`}>
      {children}
    </div>
  );
}

export function CoverageNotice({
  coverage,
  practiceName,
}: {
  coverage: MarketingCoverage;
  practiceName: string | null;
}) {
  // No ad account connected at all — the section has nothing to measure, and
  // saying so beats five tiles of zeroes.
  if (coverage.totalAccounts === 0) {
    return (
      <Notice tone="info">
        No advertising account is connected yet. Connect Google Ads or Meta Ads in
        {' '}
        <span className="font-medium text-ink">Integrations</span>
        {' '}
        to see spend, cost per lead and cost per patient here.
      </Notice>
    );
  }

  // Scoped to a practice that owns no ad account: every figure below is
  // structurally zero, and that is a mapping gap, not a performance result.
  if (coverage.practiceHasMappedAccount === false) {
    return (
      <Notice tone="warn">
        <span className="font-medium">
          No advertising account is mapped to
          {' '}
          {practiceName ?? 'this practice'}
          .
        </span>
        {' '}
        Its spend figures are zero because none of the group&apos;s advertising can be
        attributed here — not because nothing was spent. Leads and patients below are
        still this practice&apos;s own. Map an account to it under
        {' '}
        <span className="font-medium">Integrations → Ad accounts</span>
        .
      </Notice>
    );
  }

  // Group view with spend that belongs to no practice. It is inside the total
  // above, so the per-practice views cannot add up to it — say why before
  // somebody reconciles the difference by hand.
  if (coverage.unmappedSpendPence > 0) {
    const names = coverage.unmappedAccountNames.slice(0, 3).join(', ');
    const more = coverage.unmappedAccountNames.length - 3;
    return (
      <Notice tone="info">
        {formatPence(coverage.unmappedSpendPence)}
        {' '}
        of this spend sits on
        {' '}
        {coverage.unmappedAccounts}
        {' '}
        advertising
        {coverage.unmappedAccounts === 1 ? ' account' : ' accounts'}
        {' '}
        with no practice mapping (
        {names}
        {more > 0 ? `, +${more} more` : ''}
        ). It is counted in the group total but appears under no individual practice.
      </Notice>
    );
  }

  return null;
}
