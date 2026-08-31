// Every marketing figure declares how it was attributed. A blended number must
// never present itself as a measured one.
const LABEL: Record<string, string> = {
  campaign: 'Matched to campaign',
  channel: 'Channel only',
  unattributed: 'Unattributed',
};
const STYLE: Record<string, string> = {
  campaign: 'bg-brand-50 text-brand',
  channel: 'bg-[#FDF3E4] text-warning',
  unattributed: 'bg-bg text-ink-muted',
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${STYLE[tier] ?? STYLE.unattributed}`}>
      {LABEL[tier] ?? LABEL.unattributed}
    </span>
  );
}
