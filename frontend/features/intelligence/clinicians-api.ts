import { api } from '@/lib/api';

// Clinicians (GM Intelligence OS) — GET /api/analytics/clinicians.
// Per-clinician production, pay splits and NHS/UDA from REAL data: associate
// roster + treatment_plans production + appointment stats + owner-entered NHS
// contract. Money in PENCE. HONEST data walls (flags below) — no fabrication.

export interface Clinician {
  id: string;
  name: string;
  role: string;
  practiceId: string;
  practiceName: string;
  active: boolean;
  payPct: number;
  labSplitPct: number;
  productionPence: number;
  feesPence: number;
  netToPracticePence: number;
  appointments: number;
  completed: number;
  noShows: number;
}

export interface NhsPractice {
  id: string;
  name: string;
  contractUda: number;
  udaRatePence: number;
}

export interface ClinInsight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  body: string;
  value?: string;
}

export interface Clinicians {
  applicable: boolean;
  scope: string;
  message?: string;
  period?: 'month' | 'day';
  window?: { since: string; until: string; label: string };
  productionAvailable: boolean;
  appointmentsAvailable: boolean;
  clinicians: Clinician[];
  totalProductionPence: number;
  totalFeesPence: number;
  totalNetPence: number;
  nhs: {
    available: boolean;
    completedAvailable: boolean;
    practices: NhsPractice[];
  };
  insights: ClinInsight[];
  note?: string;
}

const EMPTY: Omit<Clinicians, 'applicable' | 'scope'> = {
  productionAvailable: false, appointmentsAvailable: false, clinicians: [],
  totalProductionPence: 0, totalFeesPence: 0, totalNetPence: 0,
  nhs: { available: false, completedAvailable: false, practices: [] }, insights: [],
};

export function fetchClinicians(
  scope: string,
  period: 'month' | 'day',
  pk: string,
): Promise<Clinicians> {
  const qs = `scope=${encodeURIComponent(scope)}&period=${period}&pk=${encodeURIComponent(pk)}`;
  return api<Clinicians>(`/api/analytics/clinicians?${qs}`).then((r) => ({
    ...EMPTY, ...r, applicable: r.applicable !== false,
  }));
}
