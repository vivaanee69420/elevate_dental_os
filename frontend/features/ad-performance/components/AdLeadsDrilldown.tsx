'use client';
// The people behind a number. Reuses the cockpit's LeadsTable so a lead is
// presented identically wherever it appears — the shared leads-table standard.
// The table's channel type is the cockpit's display vocabulary, so the ad
// channel is adapted to it here rather than forking the component.
import { LeadsTable, type LeadRow } from '@/features/cockpit/components/LeadsTable';
import type { LeadChannel } from '@/features/cockpit/api';
import type { AdLeadLine, PerfChannel } from '../api';

const TO_DISPLAY: Record<PerfChannel, LeadChannel> = {
  google_ads: 'google',
  meta_ads: 'facebook',
  unassigned: 'other',
};

export function AdLeadsDrilldown({ lines }: { lines: AdLeadLine[] }) {
  const rows: LeadRow[] = lines.map((l) => ({
    id: l.id,
    contactId: l.contactId,
    name: l.name,
    email: l.email,
    phone: l.phone,
    channel: TO_DISPLAY[l.channel],
    pipelineName: l.pipelineName,
    createdAt: l.createdAt,
    converted: l.converted,
    matchedTreatmentName: l.matchedTreatmentName,
    matchedValuePence: l.matchedValuePence,
    // Fields the cockpit table's row shape carries that this feature's API
    // does not supply — this page has no practice/day-level scope for these.
    practiceName: null,
    matchedPatientName: null,
    matchedAcceptedDate: null,
    alsoIn: [],
  }));
  return <LeadsTable rows={rows} />;
}
