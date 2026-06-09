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
  // Drop the business_data closing tag so a label can't terminate the block.
  s = s.split('</business_data>').join('');
  // Collapse all control chars + whitespace runs (incl. newlines/tabs) to a space.
  s = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_LABEL_LEN) s = s.slice(0, MAX_LABEL_LEN);
  return s;
}

// Serialise a snapshot into the delimited DATA block for a prompt.
export function buildContextString(snapshot) {
  return delimit('business_data', JSON.stringify(snapshot));
}
