'use client';
// ============================================================================
// The scorecard strip at the top of Cash Flow & Runway.
//
// Extracted from CashflowScreen, and rebuilt on the SHARED HeadlineCard the
// Business Hub, the QuickBooks panel and both ad reports use — not a lookalike.
// The strip previously had its own `StripKpi`, which is how it came to render
// the same Business Hub figures with none of the Hub's caveats.
//
// ============================================================================
// WHAT WAS WRONG, because the fixes only make sense against it.
//
//  1. THERE IS NO "TURNOVER" IN THIS DATA. Dentally gives takings (settled
//     payments) and invoices (billed, paid, unpaid). The strip invented a
//     turnover basis from `revenuePence` and built a Profit card on it.
//
//  2. THE PROFIT CARD MULTIPLIED TWO DIFFERENT PERIODS. profit = turnover ×
//     marginPct, where turnover is THIS WINDOW and marginPct is the trailing
//     TWELVE MONTHS, org-wide, from the P&L ledger. Pick "This month" and you
//     got one month of billed work times a year-long margin. The Business Hub
//     labels the same margin "P&L actuals, last 12 months" and shows "—" with
//     "group-level only" on a practice; this strip copied the number and
//     dropped both caveats. There is now a MARGIN card that reports the
//     percentage it actually has, and no fabricated profit amount.
//
//  3. THE TAKINGS CARD'S CHIP WAS COMPUTED FROM A DIFFERENT NUMBER. The tile
//     showed takings; the "% vs target" chip beside it was turnover ÷ revenue
//     target. Two figures, one card, no way for a reader to tell.
//
//  4. NOTHING COULD BE CHECKED. Every card now opens its own working — the
//     per-practice rows that sum to it, the feed it came from, the window it
//     covers and the figure it is being compared against.
//
// Comparison is the Business Hub's own `compare` block, so the two screens can
// never disagree about what the previous period was: both windows, their
// labels and every prior figure are resolved server-side and read from here.
// ============================================================================
import { useState } from 'react';
import { HeadlineCard, type HeadlineKpi } from '@/features/overview/components/HeadlineCard';
import { DetailModal } from '@/features/marketing/_shared/DetailModal';
import type { BusinessHub, HubComparePrev, HubPractice } from '@/features/overview/business-hub-api';
import type { CashflowOutlook } from '../api';
import { formatPence, formatNumber } from '@/lib/format';
import type { Polarity } from '@/features/marketing/_shared/compare';

const DASH = '—';

/** A line of a card's working. `value` is already formatted. */
type ProofRow = { name: string; value: string; muted?: boolean };

type Proof = {
  title: string;
  /** What the number counts, in one sentence. */
  means: string;
  /** The feed it comes from, named. */
  source: string;
  /** The period it covers — not always the page's window (see the margin). */
  covers: string;
  /** Rows that add up to the value, or the steps that produce it. */
  rows: ProofRow[];
  /** Total line under the rows, when the rows are a sum. */
  total?: ProofRow;
  /** Anything the reader must know to read the number correctly. */
  caveat?: string;
};

export default function CashflowKpiStrip({
  hub,
  outlook,
  prevOutlook,
  practiceId,
  roi,
  prevRoi,
}: {
  hub: BusinessHub;
  /** The accounting side. Undefined until the outlook request lands. */
  outlook: CashflowOutlook | undefined;
  /** The SAME endpoint asked for the comparison window. Undefined until it lands. */
  prevOutlook: CashflowOutlook | undefined;
  practiceId: string | null;
  roi: { connected?: boolean; spend_pence?: number } | null | undefined;
  prevRoi: { connected?: boolean; spend_pence?: number } | null | undefined;
}) {
  const [proof, setProof] = useState<Proof | null>(null);

  const g = hub.group;
  const cmp = g.compare;
  const scoped: HubPractice | null = practiceId
    ? hub.practices.find((p) => p.practiceId === practiceId) ?? null
    : null;
  const scopeName = scoped?.name ?? 'All practices';

  // Priors follow the practice pills exactly as the Business Hub's do: a scoped
  // card reads its OWN site's prior figure, never the group's, so a percentage
  // can never compare one practice against the whole group. A practice with no
  // prior row (opened since) gets no comparison rather than a fabricated one.
  const prev: HubComparePrev | null = cmp
    ? (scoped
        ? cmp.prev.byPractice.find((r) => r.practiceId === scoped.practiceId) ?? null
        : cmp.prev)
    : null;

  const windowLabel = cmp?.current.label ?? 'selected period';
  // Invoices arrive only in the nightly PMS pull, so the invoice cards can cover
  // fewer days than the picker asked for. Label them with the days they really
  // hold — otherwise an owner reconciling against Dentally at 4pm sees a
  // shortfall with nothing on screen to explain it.
  const invLabel = g.invoiceCoverage?.complete === false
    ? (g.invoiceCoverage.label ?? 'no invoices yet')
    : windowLabel;

  const val = <K extends keyof HubPractice>(key: K): number =>
    Number(scoped ? scoped[key] : (g as unknown as Record<string, number>)[key as string]) || 0;

  const compareOn = (
    current: number | null,
    previous: number | null,
    polarity: Polarity,
    format: (n: number) => string,
    isRate = false,
  ): HeadlineKpi['compare'] =>
    cmp ? { current, previous, polarity, isRate, format: (n) => `${format(n)} · ${cmp.previous.label}` } : undefined;

  // Per-practice rows that sum to a group figure. Under a practice scope the
  // sum is a single row, which is still the honest answer to "where does this
  // come from" rather than a table pretending to be a breakdown.
  const byPractice = (pick: (p: HubPractice) => number, format: (n: number) => string): ProofRow[] =>
    (scoped ? [scoped] : hub.practices)
      .map((p) => ({ name: p.name, value: format(pick(p)), raw: pick(p) }))
      .sort((a, b) => b.raw - a.raw)
      .map(({ name, value }) => ({ name, value }));

  const takings = val('takingsPence');
  const invoiced = val('invoicedPence');
  const unpaid = val('invoiceOutstandingPence');
  const settled = val('invoiceSettledPence');
  const newPatients = val('newPatients');
  const invoiceCount = val('invoiceCount');

  const adConnected = !!roi?.connected;
  const spendPence = adConnected ? (roi?.spend_pence ?? 0) : null;
  // Share of BILLED work, not of a "turnover" this data has no figure for.
  const spendPctInvoiced = spendPence != null && invoiced > 0
    ? Math.round((spendPence / invoiced) * 1000) / 10
    : null;
  const costPerPatient = spendPence != null && newPatients > 0 ? Math.round(spendPence / newPatients) : null;
  const conversion = scoped ? scoped.conversionRate : g.conversionRate;

  const mi = g.marginInputs;

  const dentallyCards: HeadlineKpi[] = [
    {
      // "Takings" is the word the Business Hub and the Patient Payments screen
      // both use for this feed, so the three reconcile by name as well as value.
      label: 'Takings',
      value: formatPence(takings),
      sub: `Dentally · settled payments · ${windowLabel}`,
      chip: null,
      compare: compareOn(takings, prev?.takingsPence ?? null, 'higher-better', formatPence),
      onClick: () => setProof({
        title: 'Takings',
        means: 'Money that actually reached you: patient payments recorded as settled in this period.',
        source: 'Dentally payments (the same feed as the Patient Payments “Received” tile)',
        covers: windowLabel,
        rows: byPractice((p) => p.takingsPence, formatPence),
        total: { name: scopeName, value: formatPence(takings) },
        caveat: 'Settled means the payment cleared. It is not the same as invoices marked paid, which can be cleared by a write-off.',
      }),
      hint: 'Show working',
    },
    {
      label: 'Invoiced',
      value: formatPence(invoiced),
      sub: `Dentally · billed to patients · ${invLabel}`,
      chip: invoiced > 0
        ? { text: `${formatPence(settled)} paid`, tone: 'emerald' }
        : null,
      compare: compareOn(invoiced, prev?.invoicedPence ?? null, 'higher-better', formatPence),
      onClick: () => setProof({
        title: 'Invoiced',
        means: 'The total value of invoices raised in this period — work billed, whether or not it has been paid.',
        source: 'Dentally Invoice Timeline (“Total”)',
        covers: invLabel,
        rows: [
          ...byPractice((p) => p.invoicedPence, formatPence),
          { name: '', value: '' },
          { name: 'Of which paid', value: formatPence(settled), muted: true },
          { name: 'Of which unpaid', value: formatPence(unpaid), muted: true },
          { name: 'Invoices raised', value: formatNumber(invoiceCount), muted: true },
        ],
        total: { name: scopeName, value: formatPence(invoiced) },
        caveat: g.invoiceCoverage?.complete === false
          ? 'Invoices arrive in the nightly practice-management sync, so this covers fewer days than the period you selected.'
          : undefined,
      }),
      hint: 'Show working',
    },
    {
      label: 'Unpaid invoices',
      value: formatPence(unpaid),
      sub: `Dentally · still owed to you · ${invLabel}`,
      chip: null,
      // Money owed going UP is bad news, so the polarity is inverted — a rising
      // figure gets a red arrow, not a green one.
      compare: compareOn(unpaid, prev?.invoiceOutstandingPence ?? null, 'lower-better', formatPence),
      onClick: () => setProof({
        title: 'Unpaid invoices',
        means: 'The balance still outstanding on invoices raised in this period.',
        source: 'Dentally Invoice Timeline (“Unpaid”)',
        covers: invLabel,
        rows: byPractice((p) => p.invoiceOutstandingPence, formatPence),
        total: { name: scopeName, value: formatPence(unpaid) },
        caveat: 'This is cash you have earned but not collected. It is not included in Takings.',
      }),
      hint: 'Show working',
    },
  ];

  // ── The accounting feed. QuickBooks is pulled on BOTH bases and both are in
  // monthly_financials; the page's Cost base toggle chooses which is on screen.
  // Every figure here is ORG-LEVEL — a QuickBooks company is deliberately never
  // mapped to a practice — so under a practice scope they say so rather than
  // showing the group's costs beside one site's takings.
  const costsOrgLevel = outlook?.costsUnavailableReason === 'org-level-costs';
  const sumCosts = (o: CashflowOutlook | undefined) => (o?.months ?? [])
    .filter((m) => m.costsAvailable && !m.projected)
    .reduce((n, m) => n + m.out, 0);
  const windowCosts = sumCosts(outlook);
  const prevWindowCosts = prevOutlook?.costsAvailable ? sumCosts(prevOutlook) : null;
  const basisNote = outlook?.costsAccountingBasis === 'cash' ? 'cash basis'
    : outlook?.costsAccountingBasis === 'accrual' ? 'accrual basis'
    : null;
  const feed = outlook?.outSource ?? 'your accounting feed';

  const accountingCards: HeadlineKpi[] = [
    {
      label: 'Running costs',
      value: outlook?.costsAvailable ? formatPence(windowCosts * 100) : DASH,
      sub: !outlook
        ? 'Loading'
        : costsOrgLevel
          ? 'Tracked for the group, not per practice'
          : outlook.costsAvailable
            ? `${feed}${basisNote ? ` · ${basisNote}` : ''}`
            : 'Connect QuickBooks or Xero to measure costs',
      chip: null,
      // NEUTRAL polarity, deliberately, and the same judgement the QuickBooks
      // panel makes: costs rising alongside rising takings is not bad news, and
      // costs falling because the practice did less work is not good news. The
      // verdict lives in the margin, which has both sides of it.
      compare: outlook?.costsAvailable
        ? compareOn(windowCosts * 100, prevWindowCosts == null ? null : prevWindowCosts * 100, 'neutral', formatPence)
        : undefined,
      onClick: outlook?.costsAvailable
        ? () => setProof({
            title: 'Running costs',
            means: 'What the business spent over these months, on the cost base selected above.',
            source: `${feed}, via monthly financials`,
            covers: `${outlook.months.filter((m) => m.costsAvailable && !m.projected).length} calendar months`,
            rows: outlook.months
              .filter((m) => m.costsAvailable && !m.projected)
              .map((m) => ({ name: m.month, value: formatPence(m.out * 100) })),
            total: { name: 'Total', value: formatPence(windowCosts * 100) },
            caveat: 'Costs are reported by whole calendar month, so a part-month selection still carries a full month of cost here while takings cover only the days you chose. Compare the two with that in mind.',
          })
        : undefined,
      hint: outlook?.costsAvailable ? 'Show working' : undefined,
    },
    {
      // A MARGIN, NOT A PROFIT. The old card multiplied this percentage by the
      // window's billed work and presented the result as money earned. The
      // percentage is what the data supports, so the percentage is what the
      // card promises.
      label: 'Group margin',
      value: scoped ? DASH : g.marginPct ? `${g.marginPct}%` : DASH,
      sub: scoped
        ? 'Costs are tracked for the group, not per practice'
        : g.marginPct
          ? 'P&L actuals · last 12 months, not this period'
          : 'Connect QuickBooks or Xero to measure costs',
      chip: null,
      onClick: mi && !scoped
        ? () => setProof({
            title: 'Group margin',
            means: 'Net profit as a share of revenue: what is left after every cost on the accounting feed.',
            source: 'P&L actuals from your accounting feed (monthly financials)',
            covers: `the last ${mi.monthsCovered} ledger ${mi.monthsCovered === 1 ? 'month' : 'months'}, for the whole group`,
            rows: [
              { name: 'Revenue', value: formatPence(mi.revenuePence) },
              { name: 'Less all costs', value: `−${formatPence(mi.totalCostsPence)}` },
              { name: 'Net profit', value: formatPence(mi.netProfitPence) },
            ],
            total: { name: 'Margin', value: `${g.marginPct}%` },
            caveat: 'This covers the trailing twelve months across the whole group — it does NOT move with the dates or the practice you have selected above.',
          })
        : undefined,
      hint: mi && !scoped ? 'Show working' : undefined,
    },
  ];

  const marketingCards: HeadlineKpi[] = [
    {
      label: 'Marketing spend',
      value: spendPence != null ? formatPence(spendPence) : DASH,
      sub: spendPence != null ? `Google & Meta · tracked spend · ${windowLabel}` : 'No ad account connected',
      chip: spendPctInvoiced != null
        ? { text: `${spendPctInvoiced}% of invoiced`, tone: 'amber' }
        : null,
      // Spend is neutral too: spending more is neither good nor bad without the
      // return beside it, and the return is not on this page.
      compare: spendPence != null
        ? compareOn(spendPence, prevRoi?.connected ? (prevRoi.spend_pence ?? null) : null, 'neutral', formatPence)
        : undefined,
      onClick: spendPence != null
        ? () => setProof({
            title: 'Marketing spend',
            means: 'What you paid the ad platforms over this period.',
            source: 'Google Ads and Meta Ads, via the connected ad accounts',
            covers: windowLabel,
            rows: [
              { name: 'Spend', value: formatPence(spendPence) },
              { name: 'Invoiced in the same period', value: formatPence(invoiced), muted: true },
            ],
            total: spendPctInvoiced != null
              ? { name: 'Spend as a share of invoiced work', value: `${spendPctInvoiced}%` }
              : undefined,
            caveat: 'Ad spend is attributed to the ad ACCOUNT, which maps to a practice; the invoiced figure follows the patient. A practice can legitimately show spend with little billed work behind it yet.',
          })
        : undefined,
      hint: spendPence != null ? 'Show working' : undefined,
    },
  ];

  return (
    <>
      {/* ONE grid, not three labelled sections. The sections read well but cost
          three dividers and three PARTLY FILLED rows — Marketing was a single
          card in a four-column grid — and the strip pushed the cashflow itself
          off the screen. The feed each number comes from is named on the card's
          own sub-line instead, which keeps the mixture legible in a third of
          the height. Three columns, so the two rows fall out as Dentally then
          accounting + marketing. */}
      <div className="grid gap-4 mb-6 grid-cols-2 lg:grid-cols-3">
        {[...dentallyCards, ...accountingCards, ...marketingCards].map((c) => (
          <HeadlineCard key={c.label} c={c} />
        ))}
      </div>

      <DetailModal
        open={proof !== null}
        title={proof?.title ?? ''}
        subtitle={proof ? proof.means : undefined}
        onClose={() => setProof(null)}
      >
        {proof && (
          <div style={{ fontSize: 13 }}>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginBottom: 18 }}>
              <dt className="text-ink-muted">Source</dt>
              <dd>{proof.source}</dd>
              <dt className="text-ink-muted">Covers</dt>
              <dd>{proof.covers}</dd>
            </dl>

            <table className="w-full" style={{ fontSize: 13 }}>
              <tbody>
                {proof.rows.map((r, i) => (
                  r.name === '' && r.value === ''
                    ? <tr key={`sp-${i}`}><td colSpan={2} style={{ height: 10 }} /></tr>
                    : (
                      <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className={r.muted ? 'text-ink-muted' : ''} style={{ padding: '8px 4px' }}>{r.name}</td>
                        <td
                          className={'text-right tabular-nums ' + (r.muted ? 'text-ink-muted' : '')}
                          style={{ padding: '8px 4px' }}
                        >
                          {r.value}
                        </td>
                      </tr>
                    )
                ))}
              </tbody>
              {proof.total && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td className="font-semibold" style={{ padding: '10px 4px' }}>{proof.total.name}</td>
                    <td className="text-right font-semibold tabular-nums" style={{ padding: '10px 4px' }}>
                      {proof.total.value}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            {proof.caveat && (
              <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 16, lineHeight: 1.55 }}>
                {proof.caveat}
              </p>
            )}
          </div>
        )}
      </DetailModal>
    </>
  );
}
