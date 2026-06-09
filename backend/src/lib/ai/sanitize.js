// backend/src/lib/ai/sanitize.js
// ============================================================================
// Sanitisation for AI context. Free-text fields that originate from PMS/user
// data (practice/source/clinician/leakage labels) are cleaned before they enter
// a snapshot, so injected instructions cannot ride into the model prompt.
// buildContextString wraps the whole bundle in the business_data delimiter the
// system prompt treats as untrusted DATA.
// ============================================================================
import { delimit } from "./guardrails.js";

const MAX_LABEL_LEN = 120;

// Clean a single free-text value destined for a snapshot label field.
export function sanitizeForContext(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Drop the business_data closing tag (tolerant of internal whitespace/case)
  // BEFORE collapsing, so a label can't terminate the block.
  s = s.replace(/<\/business_data\s*>/gi, '');
  // Collapse all control chars + whitespace runs (incl. newlines/tabs) to a space.
  s = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_LABEL_LEN) s = s.slice(0, MAX_LABEL_LEN).trimEnd();
  return s;
}

// Serialise a snapshot into the delimited DATA block for a prompt.
export function buildContextString(snapshot) {
  return delimit('business_data', JSON.stringify(snapshot));
}

// Sanitize every free-text label inside an assembled context bundle, in place.
// Mirrors the inline pass in buildSnapshot so the live get_metrics path produces
// an identically-defended bundle. Returns the same object for chaining.
export function sanitizeBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return bundle;
  for (const e of bundle.pl?.entities || []) e.name = sanitizeForContext(e.name);
  for (const p of bundle.practices || []) p.name = sanitizeForContext(p.name);
  for (const s of bundle.marketing?.channels || []) s.label = sanitizeForContext(s.label);
  for (const l of bundle.leakage?.lines || []) { l.label = sanitizeForContext(l.label); l.owner = sanitizeForContext(l.owner); }
  for (const c of bundle.clinicians?.top || []) c.name = sanitizeForContext(c.name);
  for (const pr of bundle.chairs?.practices || []) pr.name = sanitizeForContext(pr.name);
  return bundle;
}
