// ============================================================================
// "Is this real? Show me." — the working behind every workbench tile.
//
// ============================================================================
// THE HONEST ANSWER IS THAT MOST OF THIS IS A MODEL, NOT A MEASUREMENT, AND
// THE PROOF PANEL SAYS SO PER FIGURE.
//
// Exactly ONE input here is measured: the case fee, seeded from the mean total
// of real Dentally invoices containing that procedure (with the sample size, so
// a mean of three invoices does not read like a mean of three hundred). Every
// other input — lab bill, component prices, clinician split, marketing
// percentage, surgery run cost, utilities, throughput — is the owner's own
// figure, because nothing sends them to us. Dentally reports what the patient
// PAID and never what the work COST; QuickBooks has costs only at company
// level. So a tile is either "measured, from N invoices" or "your figure",
// and conflating the two would be the whole problem.
//
// Every number below comes from the SERVER's compute result. Re-deriving any of
// it here would be a second copy of the arithmetic, free to drift from the one
// that produced the figure on screen — which is exactly how a proof panel ends
// up disagreeing with the tile it claims to explain.
// ============================================================================
import type { TreatmentEconomics, TreatmentModel, FeeBenchmark } from '../workbench-api';

export type ProofRow = { name: string; value: string; muted?: boolean };

export type Proof = {
  title: string;
  /** What the figure means, in one sentence. */
  means: string;
  /** Measured from a feed, or entered by the owner. Never fudged between. */
  basis: string;
  /** The arithmetic, in the order it happens. */
  rows: ProofRow[];
  /** The line the tile shows. */
  total: ProofRow;
  /** Anything needed to read the number correctly. */
  caveat?: string;
  /**
   * The inputs that move this figure, when any exist. Half these tiles are
   * DERIVED and half are driven by a value the owner sets — and they looked
   * identical, so a reader could neither tell them apart nor change one.
   */
  editable?: EditableField[];
};

/**
 * The inputs behind each tile — not a label, the actual fields.
 *
 * Naming a tile "editable" and then making the reader hunt for the lever that
 * moves it is barely better than saying nothing. These descriptors let the
 * tile's own panel render the real control, so a figure is changed where it is
 * questioned. `kind` says how to read and write it: the model stores money as
 * integer pence and percentages as whole numbers.
 */
export type EditableField = {
  key: 'pricePence' | 'dentistPct' | 'marketingPct' | 'surgeries' | 'casesPerSurgery'
     | 'targetMarginPct' | 'labBillPence' | 'cbctPence' | 'surgeryRunCostPence' | 'utilitiesPence';
  label: string;
  kind: 'money' | 'pct' | 'int';
};

export const EDITABLE_BY_TILE: Record<string, EditableField[]> = {
  'Case fee': [{ key: 'pricePence', label: 'Case fee', kind: 'money' }],
  'Gross before clinician': [
    { key: 'labBillPence', label: 'Lab bill', kind: 'money' },
    { key: 'cbctPence', label: 'CBCT', kind: 'money' },
  ],
  'Clinician pay': [{ key: 'dentistPct', label: 'Clinician share', kind: 'pct' }],
  Marketing: [{ key: 'marketingPct', label: 'Marketing allowance', kind: 'pct' }],
  'Practice profit': [
    { key: 'surgeryRunCostPence', label: 'Surgery run cost', kind: 'money' },
    { key: 'utilitiesPence', label: 'Utilities', kind: 'money' },
  ],
  'Annual profit': [
    { key: 'surgeries', label: 'Surgeries per month', kind: 'int' },
    { key: 'casesPerSurgery', label: 'Cases per surgery', kind: 'int' },
  ],
  'Monthly profit': [
    { key: 'surgeries', label: 'Surgeries per month', kind: 'int' },
    { key: 'casesPerSurgery', label: 'Cases per surgery', kind: 'int' },
  ],
  'Target price': [{ key: 'targetMarginPct', label: 'Target margin', kind: 'pct' }],
  'CAC now': [{ key: 'marketingPct', label: 'Marketing allowance', kind: 'pct' }],
};

const gbp = (pence: number) =>
  `£${(Math.round(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const less = (pence: number) => `−${gbp(pence)}`;
const plus = (pence: number) => `+${gbp(pence)}`;

const YOURS = 'Your own figures — nothing sends us treatment costs.';

/**
 * Every tile's working, keyed by tile. Built from the server's economics plus
 * the model that produced them; `bench` is the real Dentally case-fee benchmark
 * when one exists for this treatment.
 */
export function buildWorkbenchProofs(
  e: TreatmentEconomics,
  m: TreatmentModel,
  bench: FeeBenchmark | null,
  benchMonths: number,
  scope: { practiceName: string | null; since: string; until: string | null } | null = null,
): Record<string, Proof> {
  const usingRealFee = !!bench?.feePence && e.pricePence === bench.feePence;
  // The measured volume, when there is one. The workbench's own throughput is
  // a hardcoded default — 1 surgery x 2 cases a month for every tenant — so
  // wherever it is multiplied out, the real figure sits beside it.
  const real = bench && bench.sampleSize > 0 ? bench : null;
  const unit = m.unit === 'implant' ? 'implant' : 'case';

  const feeBasis = usingRealFee
    ? `Measured: the mean total of ${bench!.sampleSize} real Dentally invoice${bench!.sampleSize === 1 ? '' : 's'} containing this treatment${scope?.practiceName ? ` at ${scope.practiceName}` : ' across all practices'}${scope?.since ? `, ${scope.since} to ${scope.until ?? 'today'}` : `, last ${benchMonths} months`}.`
    : 'Your own figure. A measured average from Dentally invoices may be available — see the banner above the tiles.';

  const withEditable = (proofs: Record<string, Proof>): Record<string, Proof> => {
    for (const [tile, fields] of Object.entries(EDITABLE_BY_TILE)) {
      if (proofs[tile]) proofs[tile].editable = fields;
    }
    return proofs;
  };

  return withEditable({
    'Case fee': {
      title: 'Case fee',
      means: 'What the patient pays for the whole treatment.',
      basis: feeBasis,
      rows: usingRealFee
        ? [
            { name: 'Invoices analysed', value: String(bench!.sampleSize), muted: true },
            { name: 'Mean invoice total', value: gbp(bench!.feePence) },
          ]
        : [{ name: 'Entered by you', value: gbp(e.pricePence) }],
      total: { name: 'Case fee', value: gbp(e.pricePence) },
      caveat: usingRealFee
        ? 'This is the patient FEE. What the case COSTS you is never in the Dentally feed, so every cost below is your own figure.'
        : undefined,
    },

    'Gross before clinician': {
      title: 'Gross before clinician',
      means: 'What is left of the fee once the things you buy for the case are paid for.',
      basis: YOURS,
      rows: [
        { name: 'Case fee', value: gbp(e.pricePence) },
        { name: 'Less CBCT', value: less(e.cbctPence) },
        { name: 'Less lab bill', value: less(e.labBillPence) },
        { name: 'Less components, at cost', value: less(e.compCostPence) },
      ],
      total: { name: 'Gross before clinician', value: gbp(e.grossBeforeDentistPence) },
      caveat: 'Components are subtracted at COST here. What you charge over that cost comes back in Net profit below.',
    },

    'Clinician pay': {
      title: 'Clinician pay',
      means: 'The clinician’s share of the case.',
      basis: YOURS,
      rows: [
        { name: 'Gross before clinician', value: gbp(e.grossBeforeDentistPence) },
        { name: `Clinician share`, value: `${m.dentistPct}%`, muted: true },
      ],
      total: { name: 'Clinician pay', value: gbp(e.dentistGrossPence) },
      caveat: 'Taken from the GROSS, not from the fee — so lab and component costs come out before the split.',
    },

    Marketing: {
      title: 'Marketing',
      means: 'What you allow for winning this case.',
      basis: YOURS,
      rows: [
        { name: 'Case fee', value: gbp(e.pricePence) },
        { name: 'Marketing allowance', value: `${m.marketingPct}%`, muted: true },
      ],
      total: { name: 'Marketing', value: gbp(e.marketingPence) },
      caveat: 'A percentage of the FEE, unlike the clinician split. It is an allowance you set, not measured ad spend.',
    },

    'Practice profit': {
      title: 'Practice profit',
      means: 'What the chair itself keeps, before the margin you make on parts.',
      basis: YOURS,
      rows: [
        { name: 'Gross before clinician', value: gbp(e.grossBeforeDentistPence) },
        { name: 'Less clinician pay', value: less(e.dentistGrossPence) },
        { name: 'Less marketing', value: less(e.marketingPence) },
        { name: 'Less utilities', value: less(e.utilitiesPence) },
        { name: 'Less surgery run cost', value: less(e.surgeryRunCostPence) },
      ],
      total: { name: 'Practice profit', value: gbp(e.practiceProfitPence) },
      caveat: 'This is deliberately the SMALLER number. It excludes what you make on components, lab and CBCT — those are added in Net profit.',
    },

    'Net profit / case': {
      title: `Net profit per ${unit}`,
      means: 'Everything the business keeps from this case, chair and parts together.',
      basis: YOURS,
      rows: [
        { name: 'Practice profit', value: gbp(e.practiceProfitPence) },
        { name: 'Plus margin on components', value: plus(e.compProfitPence), muted: true },
        { name: 'Plus margin on lab', value: plus(e.labProfitPence), muted: true },
        { name: 'Plus CBCT charged', value: plus(e.cbctPence), muted: true },
      ],
      total: { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
      caveat: 'This is why net profit is far larger than practice profit: components, lab and CBCT were subtracted at cost earlier and their margin is added back here.',
    },

    'Net margin': {
      title: 'Net margin',
      means: 'Net profit as a share of what the patient paid.',
      basis: YOURS,
      rows: [
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
        { name: 'Case fee', value: gbp(e.pricePence) },
      ],
      total: { name: 'Net margin', value: `${e.marginPct}%` },
    },

    'Annual profit': {
      title: 'Annual profit',
      means: 'What this treatment earns in a year at the throughput you set.',
      basis: real
        ? `Your throughput figures, multiplied out — and Dentally says you actually invoiced ${real.casesPerMonth} a month.`
        : 'Your throughput figures, multiplied out. Not a forecast of demand.',
      rows: [
        { name: 'Surgeries per month', value: String(m.surgeries) },
        { name: `${unit === 'implant' ? 'Implants' : 'Cases'} per surgery`, value: String(m.casesPerSurgery) },
        { name: `${unit === 'implant' ? 'Implants' : 'Cases'} per month, as modelled`, value: String(e.monthlyCases), muted: true },
        ...(real ? [
          { name: `Actually invoiced, per month`, value: String(real.casesPerMonth) },
          { name: `Invoices in the window`, value: String(real.sampleSize), muted: true },
        ] : []),
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
        { name: 'Months', value: '12', muted: true },
      ],
      total: { name: 'Annual profit', value: gbp(e.annualProfitPence) },
      caveat: real && real.casesPerMonth !== e.monthlyCases
        ? `This multiplies out the ${e.monthlyCases} a month you entered, NOT the ${real.casesPerMonth} Dentally recorded. At the real volume it would be ${gbp(Math.round(real.casesPerMonth * e.groupProfitPence * 12))}.`
        : 'This assumes you fill every slot you entered, every month. It is a capacity figure, not a prediction.',
    },

    'Monthly profit': {
      title: 'Monthly profit',
      means: 'What this treatment earns in a month at the throughput you set.',
      basis: 'Your throughput figures, multiplied out.',
      rows: [
        { name: `${unit === 'implant' ? 'Implants' : 'Cases'} per month, as modelled`, value: String(e.monthlyCases) },
        ...(real ? [{ name: 'Actually invoiced, per month', value: String(real.casesPerMonth) }] : []),
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
      ],
      total: { name: 'Monthly profit', value: gbp(e.monthlyProfitPence) },
      caveat: real && real.casesPerMonth !== e.monthlyCases
        ? `Based on the ${e.monthlyCases} a month you entered. Dentally recorded ${real.casesPerMonth}.`
        : undefined,
    },

    'Target price': {
      title: 'Target price',
      means: `What you would need to charge to hit a ${m.targetMarginPct}% margin, with every cost left exactly as it is.`,
      basis: YOURS,
      rows: [
        { name: 'Target margin', value: `${m.targetMarginPct}%` },
        { name: 'Margin now', value: `${e.marginPct}%`, muted: true },
        { name: 'Case fee now', value: gbp(e.pricePence), muted: true },
      ],
      total: {
        name: 'Target price',
        value: e.targetPricePence > 0 ? gbp(e.targetPricePence) : '—',
      },
      caveat: e.targetPricePence > 0
        ? 'Solved at your current costs. Raising the fee also raises the clinician pay and marketing that scale with it, and this accounts for that.'
        : 'No answer at these settings: the share of each extra pound that survives clinician pay is already below the margin you asked for, so no price reaches it. Lower the clinician split or the target.',
    },

    'Max ad / case': {
      title: `Most you can spend to win a ${unit}`,
      means: 'The largest acquisition cost this case can carry and still leave a 20% return.',
      basis: YOURS,
      rows: [
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
        { name: 'Plus the marketing already allowed', value: plus(e.marketingPence), muted: true },
        { name: 'Less 20% of the case fee', value: less(Math.round(e.pricePence * 0.2)), muted: true },
      ],
      total: { name: 'Ceiling per case', value: gbp(e.maxAdAt20Pence) },
      caveat: 'Spend above this and the case stops clearing a 20% return, however good the treatment looks.',
    },

    'CAC now': {
      title: 'Cost to acquire, now',
      means: 'What you are currently allowing to win one patient.',
      basis: YOURS,
      rows: m.unit === 'implant'
        ? [
            { name: 'Marketing per implant', value: gbp(e.marketingPence) },
            { name: 'Implants per patient', value: String(m.implantsPerPatient), muted: true },
          ]
        : [{ name: 'Marketing per case', value: gbp(e.marketingPence) }],
      total: { name: 'Per patient', value: gbp(e.cacPence) },
      caveat: m.unit === 'implant'
        ? 'Per PATIENT, not per implant — a patient having several implants costs the marketing on each.'
        : 'This is your allowance, not what your ads actually cost. Compare it with the Marketing page.',
    },

    // The two profit-planning tiles. They were clickable and opened nothing,
    // because no proof was defined for them.
    'Associate completes': {
      title: 'If an associate completes the work',
      means: 'What the business keeps when the clinician is paid their share.',
      basis: YOURS,
      rows: [
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
        { name: 'Clinician already paid', value: gbp(e.dentistGrossPence), muted: true },
      ],
      total: { name: 'You keep', value: gbp(e.associateProfitPence) },
    },

    'Principal completes': {
      title: 'If the principal completes the work',
      means: 'What the business keeps when nobody is paid a clinician share.',
      basis: YOURS,
      rows: [
        { name: `Net profit per ${unit}`, value: gbp(e.groupProfitPence) },
        { name: 'Plus the clinician share not paid out', value: plus(e.dentistGrossPence) },
      ],
      total: { name: 'You keep', value: gbp(e.principalProfitPence) },
      caveat: 'The uplift is the whole clinician share. It is not free — it is the principal’s own chair time, which could have been spent on another case.',
    },
  });
}
