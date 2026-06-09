// ============================================================================
// CRM message-template helpers. renderTemplate substitutes {{var}} placeholders
// from a flat values object; unknown / missing vars render as empty string so a
// half-populated lead never leaks a raw {{token}} into a patient message.
// ============================================================================

/** Variables a template body/subject may reference. */
export const TEMPLATE_VARIABLES = [
  'first_name',
  'last_name',
  'treatment',
  'practice',
  'appointment_date',
  'address',
  'review_link',
];

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Render a template body by replacing {{var}} with values[var].
 * Unknown or missing variables become ''.
 * @param {string} body
 * @param {Record<string, string|undefined>} values
 * @returns {string}
 */
export function renderTemplate(body, values = {}) {
  if (!body) return '';
  return body.replace(PLACEHOLDER_RE, (_match, name) => {
    const v = values[name];
    return v === undefined || v === null ? '' : String(v);
  });
}
