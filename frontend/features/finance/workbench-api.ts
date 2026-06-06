import { api } from '@/lib/api';

// Treatment Economics Workbench (Intelligence OS). Money fields are integer
// pence; *Pct are ratios. The model is owner-editable client-side and posted to
// the pure compute endpoint (no persistence yet — Arch #3).

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
}

export interface TreatmentEconomics {
  key?: string;
  label?: string;
  unit: 'case' | 'implant';
  pricePence: number;
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
export interface FeeBenchmark { feePence: number; sampleSize: number }
export interface TreatmentFeeBenchmarks {
  windowMonths: number;
  invoicesAnalysed: number;
  benchmarks: Partial<Record<'fullarch' | 'implant' | 'invisalign', FeeBenchmark | null>>;
}

export function fetchTreatmentFeeBenchmarks(): Promise<TreatmentFeeBenchmarks> {
  return api<TreatmentFeeBenchmarks>('/api/analytics/treatment-fee-benchmarks');
}
