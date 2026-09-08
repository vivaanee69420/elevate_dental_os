import { api } from '@/lib/api';

// Treatment Economics Workbench (Intelligence OS). Money fields are integer
// pence; *Pct are ratios. Edits post to a pure compute endpoint for the live
// figures, and are SAVED separately to treatment_models — the lab bill,
// component prices, surgery run cost and utilities exist in no feed (Dentally
// sends patient fees only, QuickBooks is company-level), so before persistence
// a page refresh destroyed the only copy of them.

export interface WorkbenchComponent {
  name: string;
  qty: number;
  retailPence: number;
  costPence: number;
}

export interface TreatmentModel {
  key?: string;
  label?: string;
  unit: 'case' | 'implant';
  pricePence: number;
  cbctPence: number;
  marketingPct: number;
  utilitiesPence: number;
  surgeryRunCostPence: number;
  labBillPence: number;
  labMarginPct: number;
  dentistPct: number;
  targetMarginPct: number;
  surgeries: number;
  casesPerSurgery: number;
  implantsPerPatient: number;
  components: WorkbenchComponent[];
  /** True for a treatment this organisation invented; false for a built-in
   *  (which can be RESET to its default rather than deleted). */
  isCustom?: boolean;
}

export interface TreatmentEconomics {
  key?: string;
  label?: string;
  unit: 'case' | 'implant';
  pricePence: number;
  // The inputs, echoed back by the compute. Declared so a proof panel can show
  // the working from SERVER figures rather than re-deriving them in the
  // browser — a second copy of the arithmetic is a second thing to get wrong.
  cbctPence: number;
  utilitiesPence: number;
  surgeryRunCostPence: number;
  labBillPence: number;
  compRetailPence: number;
  compCostPence: number;
  monthlyRevenuePence: number;
  marketingPence: number;
  labProfitPence: number;
  compProfitPence: number;
  directTreatmentCostPence: number;
  grossBeforeDentistPence: number;
  dentistGrossPence: number;
  practiceProfitPence: number;
  groupProfitPence: number;
  marginPct: number;
  targetPricePence: number;
  maxAdAt20Pence: number;
  cacPence: number;
  monthlyCases: number;
  patients: number;
  monthlyProfitPence: number;
  annualProfitPence: number;
  associateProfitPence: number;
  principalProfitPence: number;
  principalUpliftPence: number;
  components: (WorkbenchComponent & { profitPence: number })[];
}

export function fetchTreatmentModels(): Promise<Record<string, TreatmentModel>> {
  return api<Record<string, TreatmentModel>>('/api/analytics/compute/treatment-models');
}

export function computeTreatmentEconomics(model: TreatmentModel): Promise<TreatmentEconomics> {
  return api<TreatmentEconomics>('/api/analytics/compute/treatment-economics', {
    method: 'POST',
    body: JSON.stringify(model),
  });
}

// Real case-fee benchmarks from Dentally invoice_items. Per workbench category,
// the mean invoice total for invoices containing that procedure (patient FEE
// only — costs stay owner-entered). null per category when no matching invoices.
export interface FeeBenchmark {
  feePence: number;
  sampleSize: number;
  /** Cases actually invoiced per month over the window — the REAL throughput,
   *  against which the workbench's own surgeries x cases figure is a guess. */
  casesPerMonth: number;
  firstInvoiced: string | null;
  lastInvoiced: string | null;
}
export interface TreatmentFeeBenchmarks {
  windowMonths: number;
  since: string;
  until: string | null;
  /** Months the window really spans (40 days is 1.3, not 1). */
  monthsCovered: number;
  practiceId: string | null;
  benchmarks: Partial<Record<'fullarch' | 'implant' | 'invisalign', FeeBenchmark | null>>;
}

export function fetchTreatmentFeeBenchmarks(opts: {
  months?: number; practiceId?: string | null; since?: string | null; until?: string | null;
} = {}): Promise<TreatmentFeeBenchmarks> {
  const qs = new URLSearchParams();
  if (opts.months) qs.set('months', String(opts.months));
  if (opts.practiceId) qs.set('practice_id', opts.practiceId);
  if (opts.since && opts.until) { qs.set('since', opts.since); qs.set('until', opts.until); }
  const q = qs.toString();
  return api<TreatmentFeeBenchmarks>(`/api/analytics/treatment-fee-benchmarks${q ? `?${q}` : ''}`);
}

// --- Saving --------------------------------------------------------------
// The key lives in the PATH and the organisation comes from the session, so
// neither can be set from a request body.

export function saveTreatmentModel(key: string, model: TreatmentModel): Promise<TreatmentModel> {
  return api<TreatmentModel>(`/api/analytics/treatment-models/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(model),
  });
}

/**
 * Remove a saved model. A BUILT-IN key reverts to its default (the override row
 * is simply gone); a custom treatment is removed for good. Returns the full
 * resulting set, so the page re-renders from one source of truth rather than
 * patching its own copy and drifting from the server.
 */
export function deleteTreatmentModel(key: string): Promise<Record<string, TreatmentModel>> {
  return api<Record<string, TreatmentModel>>(`/api/analytics/treatment-models/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

/** A slug the API and the table will both accept, derived from a typed name. */
export function slugifyTreatmentKey(label: string): string {
  return label.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'treatment';
}
