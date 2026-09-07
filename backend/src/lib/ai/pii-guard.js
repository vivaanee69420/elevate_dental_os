// ============================================================================
// Patient data must never reach a model.
//
// Every AI surface in this app is built from AGGREGATES — turnover, margin,
// no-show rate, leads, per-practice totals. No prompt reads a patient row, and
// an audit of the assembly path (analytics.service.assembleLiveContext, the
// ai_context snapshot, the get_metrics tool and every builder in lib/gemini.js)
// found no patient name, email, phone, date of birth, address or clinical note
// anywhere in it.
//
// That is a property of today's code, not of the design, and it is one careless
// `.select('*')` away from changing. Nothing failed if it did: the bundle is
// JSON.stringify'd straight into a prompt, so an extra column would ride along
// silently and be sent to a third party. This is the assertion that turns the
// audit into a guarantee.
//
// FAILS CLOSED. On a hit it throws, and the calling surface takes its existing
// error path ("Could not assemble data") — the AI card is worth less than the
// leak it would otherwise print.
// ============================================================================

// Keys that can only be a person's identifying detail. Deliberately NOT `name`:
// practice, entity, channel and clinician labels legitimately use it, and
// banning it would break every surface while catching nothing patient-specific.
const FORBIDDEN_KEYS = new Set([
    'first_name', 'firstname', 'last_name', 'lastname', 'full_name', 'fullname',
    'patient_name', 'patientname', 'contact_name', 'contactname',
    'email', 'email_address', 'emailaddress',
    'phone', 'phone_number', 'phonenumber', 'mobile', 'telephone',
    'date_of_birth', 'dateofbirth', 'dob',
    'address', 'address_line_1', 'address1', 'postcode', 'post_code', 'zip',
    'nhs_number', 'nhsnumber', 'ni_number',
    'notes', 'note', 'clinical_notes', 'treatment_notes', 'comment', 'comments',
    'patient_id', 'patientid', 'pms_patient_id', 'contact_id', 'contactid',
]);

// Value-shaped detection, so a leak survives being renamed to something bland.
// Both are deliberately narrow — a false positive disables an AI card, so these
// match only what cannot plausibly be a business figure.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// A UK phone in any common shape: 07xxx / +44 / 0xxxx with 9-13 digits total.
const PHONE_RE = /(?:\+44|\b0)\d[\d\s-]{7,13}\d\b/;

function describe(path) {
    return path.length ? path.join('.') : '(root)';
}

/**
 * Walks a context bundle and throws if anything patient-identifying is in it.
 *
 * @param {unknown} value  the bundle about to be serialised into a prompt
 * @param {string} label   the surface name, for the thrown message
 * @throws {Error} naming the offending path, never the offending value — the
 *   error is logged, and logging the leak to fix the leak is not a fix.
 */
export function assertNoPatientData(value, label = 'ai context') {
    const seen = new WeakSet();

    const walk = (node, path) => {
        if (node === null || node === undefined) return;

        if (typeof node === 'string') {
            if (EMAIL_RE.test(node)) {
                throw new Error(`${label}: an email address reached the AI context at ${describe(path)}`);
            }
            if (PHONE_RE.test(node)) {
                throw new Error(`${label}: a phone number reached the AI context at ${describe(path)}`);
            }
            return;
        }
        if (typeof node !== 'object') return;

        // Cycles are not expected in a serialisable bundle, but a guard that
        // hangs is a guard that gets removed.
        if (seen.has(node)) return;
        seen.add(node);

        if (Array.isArray(node)) {
            node.forEach((v, i) => walk(v, [...path, String(i)]));
            return;
        }

        for (const [key, v] of Object.entries(node)) {
            if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
                throw new Error(`${label}: patient-identifying field "${key}" reached the AI context at ${describe(path)}`);
            }
            walk(v, [...path, key]);
        }
    };

    walk(value, []);
    return value;
}
