// Pure rendering for the daily WhatsApp report. No I/O, no system clock.
//
// The output is a SINGLE LINE with pipe separators. WhatsApp template
// parameters cannot contain newlines, tabs, or 4+ consecutive spaces
// (Meta Cloud API restriction), so multi-line layout is not an option.
//
// Separators are ASCII: if GoHighLevel counts bytes rather than characters,
// '£' already costs 2 bytes in UTF-8 and we do not want to pay for '·' too.

export const MAX_REPORT_CHARS = 350;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// London calendar parts for an instant, without pulling in a date library.
function londonParts(instant) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * The previous full calendar day in Europe/London.
 * Using the London day (not the UTC day) matters: at 00:30 London in summer it
 * is still the previous day in UTC, and reporting on the wrong date would be
 * silently wrong for part of the year.
 */
export function previousDayInLondon(now) {
    const { year, month, day } = londonParts(now);
    // Step back one day using a UTC-anchored date built from London parts.
    const anchor = new Date(Date.UTC(year, month - 1, day));
    anchor.setUTCDate(anchor.getUTCDate() - 1);

    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth();
    const d = anchor.getUTCDate();
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return { date, since: date, until: date, label: `${d} ${MONTHS[m]}` };
}

/** Integer pence to a display string. Null in, null out — callers decide the copy. */
export function formatPence(pence) {
    if (pence === null || pence === undefined) return null;
    const pounds = pence / 100;
    const abs = Math.abs(pounds);
    if (abs >= 100000) return `£${Math.round(pounds / 1000).toLocaleString('en-GB')}k`;
    if (abs >= 100) return `£${Math.round(pounds).toLocaleString('en-GB')}`;
    return `£${pounds.toFixed(2)}`;
}

/** A 0..1 ratio to a percentage string. Whole numbers stay whole. */
export function formatPercent(ratio) {
    if (ratio === null || ratio === undefined) return null;
    const pct = ratio * 100;
    const rounded = Math.round(pct * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function money(pence) {
    return formatPence(pence) ?? 'n/a';
}

function spend(pence) {
    return formatPence(pence) ?? 'not reporting';
}

/**
 * Render the report as one line.
 *
 * MAX_REPORT_CHARS is a READABILITY target, not a technical limit: the GHL
 * custom field holds 12,000 characters. A realistic line is ~216 chars and
 * even absurd values reach only ~269, so the truncation guard below should
 * never fire in practice — it exists so an unforeseen value cannot produce
 * an unreadable wall of text.
 */
export function formatReportLine(metrics) {
    const m = metrics;

    const core = [
        `Daily ${m.reportDateLabel}`,
        `Leads ${m.leads.total} (Google ${m.leads.google}, Meta ${m.leads.meta})`,
        `Spend ${spend(m.spendPence.total)} (Google ${spend(m.spendPence.google)}, Meta ${spend(m.spendPence.meta)})`,
        `CPL ${money(m.cplPence.total)}`,
        `Conv ${m.conversions} (${formatPercent(m.conversionRate) ?? 'n/a'}), CPA ${money(m.cpaPence)}`,
        `Cash in ${money(m.cashInPence)}`,
    ];

    const sections = [...core];
    if (m.dentally) {
        sections.push(
            `Appts ${m.dentally.appointments}, DNA ${m.dentally.dna} (${formatPercent(m.dentally.dnaRate) ?? 'n/a'}), New pts ${m.dentally.newPatients}`,
        );
    }
    if (m.qbo) {
        const margin = m.qbo.marginPct === null || m.qbo.marginPct === undefined
            ? 'n/a'
            : `${Math.round(m.qbo.marginPct * 10) / 10}%`;
        sections.push(`QBO MTD ${money(m.qbo.revenueMtdPence)}, margin ${margin}`);
    }

    let line = sections.join(' | ');

    // Last-resort guard against an unforeseen value; see the note above.
    if (line.length > MAX_REPORT_CHARS) line = line.slice(0, MAX_REPORT_CHARS);

    // Belt and braces — the send must never be rejected for whitespace.
    return line.replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ');
}
