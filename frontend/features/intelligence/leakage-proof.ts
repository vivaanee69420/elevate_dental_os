// ============================================================================
// The working behind every leakage figure.
//
// This page prices five "leaks" and only two of them are observations. The
// other three are planning models — a flat share of revenue, or an open-plans
// figure with no acceptance signal behind it — and a number a reader cannot
// decompose is a number they have to take on trust. Each panel therefore opens
// with what it IS before it shows any arithmetic.
//
// Every figure comes from the server's own inputs. Re-deriving a pool here
// would be a second copy of the formula, free to drift from the one that
// produced the total on screen.
// ============================================================================
import type { Leakage, LeakageLine } from './leakage-api';

export type ProofRow = { name: string; value: string; muted?: boolean };

export type Proof = {
  title: string;
  means: string;
  /** Measured from your data, or a modelling assumption. Never blurred. */
  basis: string;
  rows: ProofRow[];
  total: ProofRow;
  caveat?: string;
};

const gbp = (pence: number) =>
  `£${(Math.round(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString('en-GB');

const MEASURED = 'Measured from your own data.';
const MODELLED = 'A planning model, not an observation.';

/** How the window figure becomes a yearly one, shown so the scaling is visible. */
const annualRow = (line: LeakageLine, windowDays: number): ProofRow[] => [
  { name: `Over the ${windowDays}-day window`, value: gbp(line.windowPence) },
  { name: `Scaled to a year (x 365 / ${windowDays})`, value: gbp(line.annualPence), muted: true },
];

export function buildLeakageProof(line: LeakageLine, data: Leakage): Proof {
  const i = data.inputs;
  const rate = data.rates[line.key];
  const days = i.windowDays || data.windowDays;

  switch (line.key) {
    case 'plans': {
      const open = Math.max(0, i.presentedPence - i.acceptedPence);
      return {
        title: 'Treatment plans still open',
        means: 'Plan value presented in this window that is not yet marked completed.',
        basis: `${MODELLED} There is no acceptance signal in the feed at all — Dentally reports completion, never acceptance.`,
        rows: [
          { name: 'Plan value presented', value: gbp(i.presentedPence) },
          { name: 'Less marked completed', value: `−${gbp(i.acceptedPence)}` },
          { name: 'Still open', value: gbp(open) },
          { name: `Share you expect to close (${rate}%)`, value: gbp(line.windowPence), muted: true },
          ...annualRow(line, days),
        ],
        total: { name: 'Opportunity per year', value: gbp(line.annualPence) },
        caveat: data.planCompletionPct !== null
          ? `Only ${data.planCompletionPct}% of presented plan value is marked completed in your feed, and that rate barely moves on months a year old — so the flag is not being populated rather than the work being lost. This counts plans in progress and plans booked ahead as "open". Treat it as the size of the follow-up list, not a shortfall.`
          : undefined,
      };
    }

    case 'fta':
      return {
        title: 'Failed appointments',
        means: 'Chair time lost to patients who did not attend.',
        basis: `${MEASURED} A real no-show count over a real appointment count.`,
        rows: [
          { name: 'Appointments in the window', value: n(i.appointments) },
          { name: 'Of which no-shows', value: n(i.noShows) },
          { name: 'No-show rate', value: `${data.ftaRatePct}%`, muted: true },
          { name: 'Revenue in the window', value: gbp(i.revenuePence) },
          { name: `Share you expect to recover (${rate}%)`, value: gbp(line.windowPence), muted: true },
          ...annualRow(line, days),
        ],
        total: { name: 'Recoverable per year', value: gbp(line.annualPence) },
        caveat: 'Values the lost time at your average revenue per appointment. It assumes a recovered slot earns what a typical slot earns.',
      };

    case 'collect':
      return {
        title: 'Uncollected balances',
        means: 'Work already invoiced and still unpaid.',
        basis: `${MEASURED} The real outstanding balance on your invoices.`,
        rows: [
          { name: 'Unpaid invoice balance', value: gbp(i.outstandingPence) },
          { name: `Share you expect to collect (${rate}%)`, value: gbp(line.windowPence), muted: true },
          ...annualRow(line, days),
        ],
        total: { name: 'Recoverable per year', value: gbp(line.annualPence) },
        caveat: 'This line used to read £0.00 for every practice, because it subtracted settled receipts from themselves. It now reads the invoices feed.',
      };

    case 'recall':
      return {
        title: 'Unbooked hygiene recalls',
        means: 'Recurring hygiene revenue not rebooked.',
        basis: `${MODELLED} A fixed share of revenue, not a count of your actual recall list.`,
        rows: [
          { name: 'Revenue in the window', value: gbp(i.revenuePence) },
          { name: `Assumed hygiene share of revenue`, value: `${i.hygieneSharePct}%`, muted: true },
          { name: 'Assumed share not rebooked', value: '25%', muted: true },
          { name: `Share you expect to recover (${rate}%)`, value: gbp(line.windowPence), muted: true },
          ...annualRow(line, days),
        ],
        total: { name: 'Opportunity per year', value: gbp(line.annualPence) },
        caveat: 'Every input above the rate is an assumption, not a measurement. A real figure needs patient-level recall cohorts from Dentally.',
      };

    case 'lapsed':
    default:
      return {
        title: 'Lapsed patients',
        means: 'Patients who have not returned in over a year.',
        basis: `${MODELLED} A fixed share of revenue, not a count of your actual lapsed list.`,
        rows: [
          { name: 'Revenue in the window', value: gbp(i.revenuePence) },
          { name: 'Assumed lapsed share of revenue', value: `${i.lapsedSharePct}%`, muted: true },
          { name: `Share you expect to reactivate (${rate}%)`, value: gbp(line.windowPence), muted: true },
          ...annualRow(line, days),
        ],
        total: { name: 'Opportunity per year', value: gbp(line.annualPence) },
        caveat: 'Assumed, not counted. A real figure needs patient-level last-visit dates from Dentally.',
      };
  }
}

/** The two headline totals. They had no working at all — the largest figures on
 *  the page were the only ones a reader could not check. */
export function buildTotalProof(kind: 'measured' | 'modelled', data: Leakage): Proof {
  const lines = data.lines.filter((l) => l.basis === kind);
  const total = kind === 'measured' ? data.measuredAnnualPence : data.modelledAnnualPence;
  return {
    title: kind === 'measured' ? 'Recoverable per year - measured' : 'Modelled opportunity',
    means: kind === 'measured'
      ? 'The pools built from things actually observed in your data, added up.'
      : 'The pools built from planning assumptions, added up.',
    basis: kind === 'measured'
      ? `${MEASURED} A real no-show rate and a real unpaid invoice balance - nothing assumed.`
      : `${MODELLED} These are kept OUT of the measured headline on purpose; adding the two together is what made this page read as 77% of turnover.`,
    rows: lines.map((l) => ({ name: l.label, value: gbp(l.annualPence) })),
    total: { name: 'Per year', value: gbp(total) },
    caveat: kind === 'modelled'
      ? 'Two of these are flat shares of revenue and the third is an upper bound on open plan value. Useful for sizing an opportunity; not money anyone has lost.'
      : 'Each line still carries its own recovery rate, which you set with the sliders above.',
  };
}
