import { api } from '@/lib/api';

// Attrition & Retention (DentaCFO gap Phase 6) — GET /api/analytics/retention.
// Per-practice patient cohorts by last-visit recency (active <12mo / lapsed
// 12-24mo / dormant >24mo) + the recoverable reactivation revenue pool, all
// from data already in the warehouse (Dentally appointments + settled receipts).
// Money fields are integer PENCE; counts are integers. Gated growth.view
// (recall/marketing metric — same gate as the Loyalty page it renders on).

export type Rag = 'green' | 'amber' | 'red';
export type Tone = 'good' | 'warn' | 'bad' | 'info';

export interface RetentionCohort {
  activePatients: number;
  lapsedPatients: number;
  dormantPatients: number;
  knownPatients: number;
  retentionRatePct: number;
  attritionRatePct: number;
  reactivationRate: number;
  avgPatientValuePence: number;
  reactivatablePatients: number;
  reactivationValuePence: number;
}

export interface RetentionOrg extends RetentionCohort {
  rag: Rag;
  unlinkedAppts: number;
  revenue12mPence: number;
}

export interface RetentionPractice extends RetentionCohort {
  practiceId: string;
  name: string;
  rag: Rag;
  unlinkedAppts: number;
  revenue12mPence: number;
}

export interface RetentionInsight {
  tone: Tone;
  title: string;
  body: string;
  value: string;
}

export interface Retention {
  applicable: boolean;
  scope: string;
  message?: string;
  hasData: boolean;
  reactivationRate: number;
  org: RetentionOrg;
  practices: RetentionPractice[];
  insights: RetentionInsight[];
  generatedAt: string;
  note: string;
}

export function fetchRetention(scope = 'all'): Promise<Retention> {
  const qs = scope && scope !== 'all' ? `?scope=${encodeURIComponent(scope)}` : '';
  return api<Retention>(`/api/analytics/retention${qs}`);
}
