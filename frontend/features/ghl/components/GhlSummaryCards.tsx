'use client';
// ============================================================================
// Business Hub — GoHighLevel.
//
// Built from the page's OWN section components (HeadlineCard), not a private
// set of tiles in Tailwind's slate palette. The old cards were the only ones on
// the page painted in a colour scheme the theme does not define.
//
// Two of the four figures were also wrong, both measured on the live org for
// August 2026:
//
//   * "GHL Contacts" showed 29,419 against a true 1,596. The RPC's
//     contacts_total is CUMULATIVE — every contact ever created up to the end
//     of the window — so a card sitting under a period filter barely moved
//     whichever month was chosen. The windowed count was already in the payload
//     as contacts_new and simply was not read.
//
//   * "GHL Pipeline" showed £587,500, of which £190,000 belonged to 481 leads
//     already marked not_proceeding or failed_to_attend. Pipeline means money
//     still in play. Migration 000170 added the open-only figure beside the
//     total rather than redefining it.
//
// Conversion is decided leads only — won ÷ (won + lost) — which is NOT won ÷
// every lead, because 895 of August's 1,433 leads had not been decided either
// way. The card says which it is instead of leaving the reader to divide.
// ============================================================================

import { useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useGhlDashboard } from '../hooks';
import { SyncHealthTable } from './SyncHealthTable';
import { HeadlineCard, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import type { Polarity } from '@/features/marketing/_shared/compare';

export function GhlSummaryCards({
  since, until, accountId = null, compare = null,
}: {
  since?: string; until?: string; accountId?: string | null;
  /** The page's own comparison window, so this section measures across exactly
   *  the same bounds as the Dentally and Marketing sections above it. */
  compare?: { previous: { since: string; until: string; label: string } } | null;
}) {
  const { data } = useGhlDashboard({ since, until, accountId });
  // The SAME endpoint over the comparison window — the prior figure cannot
  // drift from the one it measures, because it IS that figure asked for a
  // different month.
  const { data: was } = useGhlDashboard(
    compare ? { since: compare.previous.since, until: compare.previous.until, accountId } : {},
  );
  const [open, setOpen] = useState(false);

  if (!data || data.totals.sync.accounts === 0) return null;
  const t = data.totals;
  const p = compare && was ? was.totals : null;

  const cmp = (
    current: number | null, previous: number | null,
    polarity: Polarity, format: (n: number) => string, isRate = false,
  ): HeadlineKpi['compare'] => (compare && p ? {
    current, previous, polarity, isRate,
    format: (n) => `${format(n)} · ${compare.previous.label}`,
  } : undefined);

  const countOf = (n: number) => formatNumber(n);

  const cards: HeadlineKpi[] = [
    {
      label: 'New contacts',
      value: formatNumber(t.contacts.new),
      sub: `${formatNumber(t.contacts.total)} contacts held for ${accountId ? 'this subaccount' : 'these subaccounts'}`,
      chip: null,
      compare: cmp(t.contacts.new, p?.contacts.new ?? null, 'higher-better', countOf),
      // Says "held", not "on the books": the two are not the same number and
      // the difference is deliberate. One person who exists in two GoHighLevel
      // locations is ONE contact here — 552 email addresses and 687 phone
      // numbers appear in more than one of this group's locations — so a
      // per-subaccount total is legitimately lower than what that location
      // reports, and the group total is lower than the sum of the locations.
      source: 'GoHighLevel contacts created inside the selected period. The figure beneath is how many contacts we hold for the selected subaccounts, which is not the same as the contact count GoHighLevel shows per location: a person who exists in two of your locations is one contact here, counted once, under whichever location saw them first.',
      onClick: () => setOpen((v) => !v),
      active: open,
      hint: open ? 'Hide subaccounts' : 'Click for the breakdown',
    },
    {
      label: 'Leads',
      value: formatNumber(t.leads.total),
      sub: `${formatNumber(t.leads.open)} still open · ${formatNumber(t.leads.won)} won · ${formatNumber(t.leads.lost)} lost`,
      chip: null,
      compare: cmp(t.leads.total, p?.leads.total ?? null, 'higher-better', countOf),
      source: 'GoHighLevel opportunities created inside the selected period, across every connected subaccount.',
      onClick: () => setOpen((v) => !v),
      active: open,
    },
    {
      label: 'Open pipeline',
      value: formatPence(t.leads.pipelineOpenValuePence),
      sub: `Undecided leads only · ${formatPence(t.leads.pipelineValuePence)} incl. won and lost`,
      chip: null,
      compare: cmp(t.leads.pipelineOpenValuePence, p?.leads.pipelineOpenValuePence ?? null, 'higher-better', formatPence),
      source: 'Estimated value of leads that have not been decided either way. The figure beside it adds back leads already marked not proceeding or failed to attend — money no longer in play, which is why it is not the headline.',
      onClick: () => setOpen((v) => !v),
      active: open,
    },
    {
      label: 'Conversion',
      // A rate with no denominator is unknowable, not 0%: a period where no
      // lead was decided either way has no conversion rate to report.
      value: t.leads.won + t.leads.lost > 0 ? `${t.leads.conversionPct}%` : '—',
      sub: `${formatNumber(t.leads.won)} won of ${formatNumber(t.leads.won + t.leads.lost)} decided`,
      chip: null,
      compare: t.leads.won + t.leads.lost > 0
        ? cmp(t.leads.conversionPct, (p && p.leads.won + p.leads.lost > 0) ? p.leads.conversionPct : null,
          'higher-better', (n) => `${n}%`, true)
        : undefined,
      source: 'Won leads as a share of leads that reached a decision — NOT of every lead. Most leads in a recent period are still open, so dividing by the full lead count would understate the rate for the newest month and flatter the oldest.',
      onClick: () => setOpen((v) => !v),
      active: open,
    },
  ];

  return (
    <>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => <HeadlineCard key={c.label} c={c} />)}
      </div>
      {open && (
        <div className="mt-4">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-2">By subaccount</div>
          <SyncHealthTable accounts={data.perAccount} />
        </div>
      )}
    </>
  );
}
