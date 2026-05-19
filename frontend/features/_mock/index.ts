// Shared mock-data layer for the UI port.
//
// One source of truth for fixtures every section screen needs (practice
// names, pipeline stages, money formatting, deterministic random). Mirrors
// constants in preview/elevate-dental-os-v2.html so ported screens render
// pixel-faithful with no backend. When real endpoints land, screens swap
// their feature-local data source; this module's contracts stay stable.
//
// Convention: amounts here are WHOLE POUNDS (matches the prototype's
// arithmetic). The real backend uses integer pence (lib/formulas.js);
// pence->pound conversion happens at the future swap point, not here.
//
// Frozen Phase-0 module. Section agents import from here; they do not edit
// it. Need a new shared fixture? Stop and report — it gets added centrally.

/** The five practices in the demo group, in display order. */
export const PRACTICES = [
  'Ashford Dental',
  'Rochester Dental',
  'Barnet Dental',
  'Warwick Lodge Implant Centre',
  'Fixed Teeth Solutions Bexleyheath',
] as const;

export type Practice = (typeof PRACTICES)[number];

/** Org display name shown in the topbar. */
export const ORG_NAME = 'GM Dental Group';

/** Canonical pipeline stages (key + UK English label), prototype order. */
export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contact_attempted', label: 'Contact attempted' },
  { key: 'contact_made', label: 'Contact made' },
  { key: 'consultation_booked', label: 'Consult booked' },
  { key: 'consultation_attended', label: 'Consult attended' },
  { key: 'treatment_started', label: 'Treatment started' },
  { key: 'treatment_completed', label: 'Treatment completed' },
  { key: 'not_proceeding', label: 'Not proceeding' },
  { key: 'failed_to_attend', label: 'Failed to attend' },
  { key: 'paused', label: 'Paused' },
] as const;

export type StageKey = (typeof STAGES)[number]['key'];

/** Look up a stage's human label by key; falls back to the raw key. */
export function stageLabel(key: string): string {
  return STAGES.find((s) => s.key === key)?.label ?? key;
}

/**
 * Format a whole-pound amount as British currency, no decimals.
 * e.g. 124500 -> "£124,500". Honors project rule 2 (en-GB grouping).
 */
export function formatPounds(pounds: number): string {
  return '£' + Math.round(pounds).toLocaleString('en-GB');
}

/**
 * Format a fraction (0..1) as a whole-number percentage.
 * e.g. 0.235 -> "24%".
 */
export function formatPct(fraction: number): string {
  return Math.round(fraction * 100) + '%';
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 * Same seed -> same sequence, so mock screens are stable across renders and
 * snapshot tests. Returns a function yielding floats in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a deterministic element from a list given a 0..1 roll. */
export function pick<T>(list: readonly T[], roll: number): T {
  return list[Math.floor(roll * list.length) % list.length];
}

/** A generic mocked person used by CRM/Growth screens. */
export interface MockContact {
  id: string;
  name: string;
  practice: Practice;
  stage: StageKey;
  value: number; // whole pounds
  source: string;
  updatedDaysAgo: number;
}

const FIRST = ['James', 'Priya', 'Sophie', 'Mohammed', 'Grace', 'Daniel', 'Aisha', 'Tom', 'Chloe', 'Raj'];
const LAST = ['Patel', 'Smith', 'Khan', 'Jones', 'Okafor', 'Brown', 'Ahmed', 'Taylor', 'Evans', 'Singh'];
const SOURCES = ['Google Ads', 'Referral', 'Website', 'Facebook', 'Walk-in', 'Recall'];

/**
 * Build `count` deterministic mock contacts from a seed.
 * Used by pipeline, leads, patients, enquiries, and reports screens so they
 * all show a consistent population. Seed varies the set per screen.
 */
export function mockContacts(count: number, seed = 42): MockContact[] {
  const rnd = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `c${seed}-${i}`,
    name: `${pick(FIRST, rnd())} ${pick(LAST, rnd())}`,
    practice: pick(PRACTICES, rnd()),
    stage: pick(STAGES, rnd()).key,
    value: 800 + Math.floor(rnd() * 9200),
    source: pick(SOURCES, rnd()),
    updatedDaysAgo: Math.floor(rnd() * 30),
  }));
}
