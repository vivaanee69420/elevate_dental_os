// ============================================================================
// Practitioner utilisation — the rules that turn diary rows into a figure.
//
// Dentally's own guidance for rebuilding their view:
//   available = practitioner working hours from the calendar schedule
//   utilised  = appointments with a PATIENT attached
//   appointments with no patient are UNUSED time, not utilisation
//
// TWO DECISIONS LIVE HERE, both measured, both stated on the screen.
//
// 1. A DAY OF NOTHING BUT BLOCKS IS "NOT WORKING", NOT 0%.
//    Dentally exposes no roster (probed: /practitioners has no hours, ten
//    candidate roster endpoints 404, and /appointments/availability refuses a
//    past start_time). So availability is the practitioner's own booked day
//    span, and a day with no patient appointment at all carries no signal that
//    they were rostered — only that something sat in their diary.
//
//    Measured on GM Dental Group, 1–7 September: 180 of 234 practitioner-days
//    had no patient appointments, and those days carried 1,440 of the 1,837
//    "available" hours. Counting them drags utilisation to 15.3%; excluding
//    them gives 70.7% over the 54 days someone was actually seeing patients.
//    Neither number is wrong — they answer different questions — but a
//    clinician who was not in is not a clinician who sat idle, so those days
//    are the "unavailable" state and the screen SAYS how many it set aside.
//
// 2. TOTALS ARE A RATIO OF SUMS, NEVER AN AVERAGE OF RATIOS.
//    The same week reads 70.7% pooled and 68.8% as a mean of daily
//    percentages. The mean flatters short days: a practitioner with one
//    45-minute span and one patient scores 100% and counts as much as a
//    full nine-hour list. Every headline here divides total utilised by total
//    available.
// ============================================================================
import { practitionerUtilisationRepository } from "../repositories/practitioner-utilisation.repository.js";

const HOUR = 3600;

/** The value appearing most often, or null when there is none. */
function mostCommon(values) {
    const counts = new Map();
    for (const v of values) {
        if (v == null) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best = null;
    let bestN = 0;
    for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
    return best;
}

/** Pence per hour, or null when there are no hours to divide by. */
function perHour(pence, secs) {
    if (!secs || pence == null) return null;
    return Math.round(pence / (secs / HOUR));
}

export const practitionerUtilisationService = {
    async overview(orgId, { since, until, practiceId = null }) {
        const rows = await practitionerUtilisationRepository.daily(orgId, { since, until, practiceId });

        const norm = rows.map((r) => ({
            practitionerId: String(r.practitioner_id),
            practitionerName: r.practitioner_name,
            practiceId: r.practice_id ?? null,
            day: r.day,
            availableSecs: Number(r.available_secs) || 0,
            utilisedSecs: Number(r.utilised_secs) || 0,
            patientAppts: Number(r.patient_appts) || 0,
            blockAppts: Number(r.block_appts) || 0,
            // Null, never 0: a day with no invoicing has no revenue figure, and
            // "£0.00 earned" is a different claim from "nothing was invoiced".
            revenuePence: r.revenue_pence == null ? null : Number(r.revenue_pence),
        }));

        // Decision 1. Kept separately rather than filtered away silently.
        const working = norm.filter((r) => r.patientAppts > 0);
        const blockOnly = norm.filter((r) => r.patientAppts === 0);

        const sum = (list, key) => list.reduce((a, r) => a + (r[key] ?? 0), 0);
        const availableSecs = sum(working, 'availableSecs');
        const utilisedSecs = sum(working, 'utilisedSecs');
        const revenuePence = working.reduce((a, r) => a + (r.revenuePence ?? 0), 0);
        const anyRevenue = working.some((r) => r.revenuePence != null);

        // Decision 2.
        const utilisationPct = availableSecs > 0
            ? Math.round((utilisedSecs / availableSecs) * 1000) / 10
            : null;

        // Per day, for the availability/usage chart. Every day in the window
        // appears, including those with nothing — a gap drawn as a missing
        // point reads as "no data", where a real zero is a real fact.
        const byDay = new Map();
        for (const r of working) {
            const d = byDay.get(r.day) ?? { day: r.day, availableSecs: 0, utilisedSecs: 0, practitioners: new Set(), revenuePence: 0, hasRevenue: false };
            d.availableSecs += r.availableSecs;
            d.utilisedSecs += r.utilisedSecs;
            d.practitioners.add(r.practitionerId);
            if (r.revenuePence != null) { d.revenuePence += r.revenuePence; d.hasRevenue = true; }
            byDay.set(r.day, d);
        }
        const days = [...byDay.values()]
            .sort((a, b) => a.day.localeCompare(b.day))
            .map((d) => ({
                day: d.day,
                availableHours: Math.round((d.availableSecs / HOUR) * 10) / 10,
                utilisedHours: Math.round((d.utilisedSecs / HOUR) * 10) / 10,
                unusedHours: Math.round(((d.availableSecs - d.utilisedSecs) / HOUR) * 10) / 10,
                utilisationPct: d.availableSecs > 0
                    ? Math.round((d.utilisedSecs / d.availableSecs) * 1000) / 10
                    : null,
                practitioners: d.practitioners.size,
                revenuePence: d.hasRevenue ? d.revenuePence : null,
            }));

        // Per practitioner, for the grid rows and the league table.
        const byPract = new Map();
        for (const r of working) {
            const p = byPract.get(r.practitionerId) ?? {
                practitionerId: r.practitionerId, practitionerName: r.practitionerName,
                availableSecs: 0, utilisedSecs: 0, patientAppts: 0, revenuePence: 0,
                hasRevenue: false, days: [],
            };
            p.availableSecs += r.availableSecs;
            p.utilisedSecs += r.utilisedSecs;
            p.patientAppts += r.patientAppts;
            if (r.revenuePence != null) { p.revenuePence += r.revenuePence; p.hasRevenue = true; }
            p.days.push({
                day: r.day,
                // The practice this day was worked at. A practitioner can move
                // between sites, so it belongs to the DAY, not to the person.
                practiceId: r.practiceId,
                utilisationPct: r.availableSecs > 0
                    ? Math.round((r.utilisedSecs / r.availableSecs) * 1000) / 10
                    : null,
                availableHours: Math.round((r.availableSecs / HOUR) * 10) / 10,
                utilisedHours: Math.round((r.utilisedSecs / HOUR) * 10) / 10,
                patientAppts: r.patientAppts,
                revenuePence: r.revenuePence,
            });
            byPract.set(r.practitionerId, p);
        }
        const practitioners = [...byPract.values()]
            .map((p) => ({
                practitionerId: p.practitionerId,
                practitionerName: p.practitionerName,
                // The site they worked most days at in this window — a label
                // for the row, never a claim that every day was there. The
                // per-day practice above is the accurate one.
                practiceId: mostCommon(p.days.map((d) => d.practiceId)),
                daysWorked: p.days.length,
                availableHours: Math.round((p.availableSecs / HOUR) * 10) / 10,
                utilisedHours: Math.round((p.utilisedSecs / HOUR) * 10) / 10,
                utilisationPct: p.availableSecs > 0
                    ? Math.round((p.utilisedSecs / p.availableSecs) * 1000) / 10
                    : null,
                patientAppts: p.patientAppts,
                revenuePence: p.hasRevenue ? p.revenuePence : null,
                // The money translation of a chair-hour. Null on a zero
                // denominator, never £0.00.
                revenuePerUtilisedHourPence: p.hasRevenue ? perHour(p.revenuePence, p.utilisedSecs) : null,
                days: p.days.sort((a, b) => a.day.localeCompare(b.day)),
            }))
            .sort((a, b) => (b.utilisationPct ?? -1) - (a.utilisationPct ?? -1));

        const unusedSecs = Math.max(0, availableSecs - utilisedSecs);
        const revenuePerUtilisedHour = anyRevenue ? perHour(revenuePence, utilisedSecs) : null;

        return {
            window: { since, until },
            totals: {
                utilisationPct,
                availableHours: Math.round((availableSecs / HOUR) * 10) / 10,
                utilisedHours: Math.round((utilisedSecs / HOUR) * 10) / 10,
                unusedHours: Math.round((unusedSecs / HOUR) * 10) / 10,
                practitioners: new Set(working.map((r) => r.practitionerId)).size,
                daysWorked: working.length,
                patientAppts: sum(working, 'patientAppts'),
                revenuePence: anyRevenue ? revenuePence : null,
                revenuePerUtilisedHourPence: revenuePerUtilisedHour,
                revenuePerAvailableHourPence: anyRevenue ? perHour(revenuePence, availableSecs) : null,
                // What the empty time would have been worth AT THE RATE THIS
                // PRACTICE ACTUALLY ACHIEVES on its used hours. Not a target,
                // not a promise — an arithmetic restatement of the gap, which
                // is the only honest way to price it.
                unusedHoursValuePence: revenuePerUtilisedHour == null
                    ? null
                    : Math.round(revenuePerUtilisedHour * (unusedSecs / HOUR)),
            },
            // Stated, not hidden: the reader can see how much of the diary was
            // set aside and decide whether they believe the headline.
            excluded: {
                blockOnlyDays: blockOnly.length,
                blockOnlyHours: Math.round((sum(blockOnly, 'availableSecs') / HOUR) * 10) / 10,
                practitioners: new Set(blockOnly.map((r) => r.practitionerId)).size,
            },
            days,
            practitioners,
        };
    },
};
