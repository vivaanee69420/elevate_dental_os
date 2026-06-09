import { api } from '@/lib/api';
import type { ResolvedWindow } from '@/features/_shared/scope-context';

// Board Report Generator (DentaCFO gap module, Phase 2). The pack is assembled
// live from the same rollups as Business Hub + Revenue Leakage — group
// turnover/margin, conversion, banked cash, top vs weakest practice and the
// biggest recoverable leak. Claude writes the exec summary + RAG priorities;
// a deterministic data-driven pack is the fallback. Money is integer PENCE.
//
// Generate + email are POST (token cost / outbound) — never on page load.

export type Rag = 'red' | 'amber' | 'green';

export interface BoardPriority {
  rag: Rag;
  text: string;
}

export interface BoardMetrics {
  revenuePence: number;
  revenueAnnualisedPence: number;
  revenueTargetPence: number;
  marginPct: number;
  ebitdaWindowPence: number;
  appointments: number;
  noShows: number;
  noShowRate: number;
  noShowTracked: boolean;
  leads: number;
  conversionRate: number;
  newPatients: number;
  cashCollectedPence: number;
  practiceCount: number;
  leakageAnnualPence: number;
  leakageMonthlyPence: number;
  leakagePctOfRevenue: number;
  topPractice: { name: string; revenuePence: number } | null;
  weakPractice: { name: string; noShowRate: number } | null;
  biggestLeak: { label: string; annualPence: number; owner: string } | null;
}

export interface BoardReport {
  generatedAt: string;
  period: { since: string; until: string | null; label: string; days: number };
  metrics: BoardMetrics;
  summary: string[];
  priorities: BoardPriority[];
  basis: 'ai' | 'deterministic';
  empty: boolean;
}

export interface EmailResult {
  report: BoardReport;
  delivery: { sent: boolean; messageId?: string; error?: string; to: string };
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';
export type ReportType = 'board' | 'financial' | 'operational';

export interface BoardSchedule {
  id: string;
  organisation_id: string;
  frequency: ScheduleFrequency;
  recipient_email: string;
  report_type: ReportType;
  active: boolean;
  last_sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

function windowBody(win: ResolvedWindow) {
  return { since: win.since, until: win.until, label: win.label };
}

export function generateBoardReport(win: ResolvedWindow): Promise<BoardReport> {
  return api<BoardReport>('/api/analytics/board-report', {
    method: 'POST',
    body: JSON.stringify(windowBody(win)),
  });
}

export function emailBoardReport(win: ResolvedWindow, recipientEmail: string): Promise<EmailResult> {
  return api<EmailResult>('/api/analytics/board-report/email', {
    method: 'POST',
    body: JSON.stringify({ ...windowBody(win), recipient_email: recipientEmail }),
  });
}

export function fetchBoardSchedules(): Promise<BoardSchedule[]> {
  return api<BoardSchedule[]>('/api/analytics/board-report/schedules');
}

export function createBoardSchedule(input: {
  frequency: ScheduleFrequency;
  recipient_email: string;
  report_type?: ReportType;
}): Promise<BoardSchedule> {
  return api<BoardSchedule>('/api/analytics/board-report/schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateBoardSchedule(id: string, fields: Partial<Pick<BoardSchedule, 'active' | 'frequency' | 'recipient_email' | 'report_type'>>): Promise<BoardSchedule> {
  return api<BoardSchedule>(`/api/analytics/board-report/schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export function deleteBoardSchedule(id: string): Promise<void> {
  return api<void>(`/api/analytics/board-report/schedules/${id}`, { method: 'DELETE' });
}
