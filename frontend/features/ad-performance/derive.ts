// Pure derivations over the lead rows the API already returns. No React, no
// fetching — everything here is computed from one `GET /ad-attribution/leads`
// response so the page issues a single request for all its drill-downs.
import type { AdLeadLine, PerfChannel } from './api';

// Identify a person the same way the shared cockpit LeadsTable does
// (`dedupeByPerson`, LeadsTable.tsx): contactId, falling back to a synthetic
// per-row key. KNOWN LIMITATION: a lead with a null contactId gets a unique
// key and therefore can never be seen as overlapping, even if the same human
// really did enquire through both channels. Every count derived from this is a
// LOWER BOUND on true overlap and must be presented as such.
export function personKey(l: AdLeadLine): string {
  return l.contactId ?? `lead:${l.id}`;
}

// The API dedupes per `channel|personKey`, so a person in two channels comes
// back twice. Collapse to one row per person, keeping the earliest touch. The
// returned list is sorted most-recent-first (newest createdAt first).
export function distinctPeople(lines: AdLeadLine[]): AdLeadLine[] {
  const byPerson = new Map<string, AdLeadLine>();
  for (const l of lines) {
    const key = personKey(l);
    const seen = byPerson.get(key);
    if (!seen || Date.parse(l.createdAt) < Date.parse(seen.createdAt)) byPerson.set(key, l);
  }
  return Array.from(byPerson.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface OverlapPerson {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  channels: PerfChannel[];
}

// People who appear under more than one channel — the gap between the deduped
// group total and the sum of the channel columns, as a list of names.
export function overlapPeople(lines: AdLeadLine[]): OverlapPerson[] {
  const byPerson = new Map<string, OverlapPerson>();
  for (const l of lines) {
    const key = personKey(l);
    const seen = byPerson.get(key);
    if (!seen) {
      byPerson.set(key, { key, name: l.name, email: l.email, phone: l.phone, channels: [l.channel] });
      continue;
    }
    if (!seen.channels.includes(l.channel)) seen.channels.push(l.channel);
  }
  return Array.from(byPerson.values()).filter((p) => p.channels.length > 1);
}

export interface MatchStats {
  matched: number;
  total: number;
  /** null when there are no leads at all — 0/0 is not 0%. */
  rate: number | null;
  matchedValuePence: number;
}

// How many distinct people tie to an accepted treatment in Emergent, and the
// value carried by those matches.
export function matchStats(lines: AdLeadLine[]): MatchStats {
  const people = distinctPeople(lines);
  const matched = people.filter((l) => l.matchedTreatmentName !== null);
  return {
    matched: matched.length,
    total: people.length,
    rate: people.length === 0 ? null : matched.length / people.length,
    matchedValuePence: matched.reduce((n, l) => n + l.matchedValuePence, 0),
  };
}
