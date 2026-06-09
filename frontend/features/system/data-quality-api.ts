import { api } from '@/lib/api';

// Data Quality Engine (DentaCFO gap module) — GET /api/analytics/data-quality.
// Per-practice cleanliness score + connector health + prioritised alerts, all
// derived from data already in the warehouse (appointments / invoices /
// integrations). Money fields are integer PENCE. Gated system.manage (matches
// the Data Hub page), so it lives under features/system, not finance.

export type Rag = 'green' | 'amber' | 'red';
export type Severity = 'high' | 'medium' | 'low';
export type ConnectorHealth = 'ok' | 'stale' | 'never' | 'disconnected' | 'expired' | 'error';

export interface QualityDim {
  key: 'coded' | 'linked' | 'invoiceMatch' | 'collection';
  label: string;
  weight: number;
  ratePct: number;
  defects: number;
  of: number;
}

export interface PracticeQuality {
  practiceId: string;
  name: string;
  score: number;
  rag: Rag;
  records: number;
  unassignedAppts: number;
  dims: QualityDim[];
  raw: {
    totalAppts: number;
    uncodedAppts: number;
    unlinkedAppts: number;
    unassignedAppts: number;
    totalInvoices: number;
    unmatchedInvoices: number;
    invoicedPence: number;
    outstandingPence: number;
  };
}

export interface ConnectorState {
  provider: string;
  label: string;
  status: string;
  lastSyncedAt: string | null;
  ageHours: number | null;
  staleAfterHours: number;
  lastError: string | null;
  health: ConnectorHealth;
}

export interface QualityAlert {
  severity: Severity;
  area: 'connector' | 'practice' | 'org';
  key: string;
  text: string;
}

export interface DataQuality {
  orgScore: number;
  rag: Rag;
  practices: PracticeQuality[];
  totals: {
    totalAppts: number;
    uncodedAppts: number;
    unlinkedAppts: number;
    unassignedAppts: number;
    totalInvoices: number;
    unmatchedInvoices: number;
    invoicedPence: number;
    outstandingPence: number;
  };
  connectors: ConnectorState[];
  alerts: QualityAlert[];
  generatedAt: string;
}

export function fetchDataQuality(): Promise<DataQuality> {
  return api<DataQuality>('/api/analytics/data-quality');
}
