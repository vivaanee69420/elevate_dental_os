// ============================================================================
// Practitioner performance — one row per clinician, four things about them.
//
// TIME, TREATMENT, MONEY, and how much of the day was actually used. Each of
// those already exists somewhere in the product; what did not exist was them
// side by side, which is the only way to see that the busiest clinician is not
// the most productive one.
//
// It is composed from the two reads that already own these facts rather than a
// third query of its own: practitioner_utilisation_daily (time, appointments,
// invoiced revenue) and treatments_completed_by_practitioner (volume). If this
// re-derived either, the page would be free to disagree with the Utilisation
// screen and the Business Hub card about the same window, and there would be
// no way to tell which was right.
//
// THE RULES THAT DECIDE THE NUMBERS, all of them stated rather than implied:
//
//   * Every rate is NULL on a zero denominator, never 0. "£0 per hour" is a
//     claim about performance; a dash is the truth when nobody worked.
//   * Utilisation uses whatever basis the caller picked, and says which.
//   * Revenue here is INVOICED fees (invoice_items), which is what the
//     practitioner billed. Treatment VALUE is the list price of the items they
//     completed. They are different numbers on purpose and both are shown -
//     collapsing them into one "revenue" column would hide the gap between
//     work done and work billed.
//   * A practitioner with no completed-treatment rows gets null, not zero,
//     when the whole feed is unavailable, and zero when the feed works and
//     they genuinely completed none. Those are different facts.
// ============================================================================
import { practitionerUtilisationRepository } from "../repositories/practitioner-utilisation.repository.js";

const HOUR = 3600;

/** Pence per hour, or null when there are no hours to divide by. */
function perHour(pence, secs) {
    if (!secs || pence == null) return null;
    return Math.round(pence / (secs / HOUR));
}

/** The value that appears most often, for labelling a row by its usual site. */
function mostCommon(values) {
    const counts = new Map();
    for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = null;
    let bestN = 0;
    for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
    return best;
}

const round1 = (n) => Math.round(n * 10) / 10;

export const practitionerPerformanceService = {
    async overview(orgId, { since, until, practiceId = null, basis = 'rota' }) {
        const [rows, treatmentRows, topRows] = await Promise.all([
            practitionerUtilisationRepository.daily(orgId, { since, until, practiceId }),
            practitionerUtilisationRepository.treatmentsByPractitioner(orgId, { since, until, practiceId }),
            practitionerUtilisationRepository.topTreatments(orgId, { since, until, practiceId }),
        ]);

        // null means the feed itself is unavailable on this database, which is
        // NOT the same as every clinician having completed nothing.
        const treatmentsAvailable = treatmentRows !== null;
        const treatments = new Map();
        for (const t of treatmentRows ?? []) {
            treatments.set(String(t.practitioner_id), {
                treatments: Number(t.treatments) || 0,
                patients: Number(t.patients) || 0,
                valuePence: Number(t.value_pence) || 0,
                durationMinutes: Number(t.duration_minutes) || 0,
                // Null when every item they completed was unnamed — "" is not
                // an answer, and a blank card is more honest than one.
                topTreatment: t.top_treatment ?? null,
                topTreatmentCount: t.top_treatment_count == null ? null : Number(t.top_treatment_count),
            });
        }

        // The denominator, chosen once. Kept identical to the Utilisation
        // screen's rule so the two pages cannot disagree.
        const available = (r) => {
            if (basis === 'span') return Number(r.available_secs) || 0;
            if (basis === 'rota') return r.rota_secs == null ? 0 : Number(r.rota_secs);
            return Number(r.clinical_secs) || 0;
        };
        // On the rota basis a rostered day with no patients is the finding, so
        // it counts; on the other two such a day has no measurable window.
        const countsTowardTime = (r, clinicians) => (basis === 'rota'
            ? clinicians.has(String(r.practitioner_id)) && r.rostered === true
            : (Number(r.patient_appts) || 0) > 0);

        const clinicians = new Set(
            rows.filter((r) => (Number(r.patient_appts) || 0) > 0).map((r) => String(r.practitioner_id)),
        );

        const byPract = new Map();
        for (const r of rows) {
            const id = String(r.practitioner_id);
            // Somebody who treated nobody all window is not a clinician for
            // this page. The rota rosters reception and admin too.
            if (!clinicians.has(id)) continue;
            const p = byPract.get(id) ?? {
                practitionerId: id,
                practitionerName: r.practitioner_name,
                practices: [],
                availableSecs: 0, utilisedSecs: 0, breakSecs: 0,
                daysWorked: 0, daysRostered: 0, daysOffRota: 0, daysNoRota: 0,
                patientAppts: 0, revenuePence: 0, hasRevenue: false,
                // The daily series behind this practitioner's trend line. Built
                // from the SAME rows as their totals, so the chart and the card
                // can never disagree about one window.
                days: [],
            };
            p.practices.push(r.practice_id ?? null);
            p.patientAppts += Number(r.patient_appts) || 0;
            if (r.revenue_pence != null) { p.revenuePence += Number(r.revenue_pence); p.hasRevenue = true; }
            if ((Number(r.patient_appts) || 0) > 0) p.daysWorked++;
            if (r.rostered === true) p.daysRostered++;
            else if (r.rostered === false) p.daysOffRota++;
            else p.daysNoRota++;
            if (countsTowardTime(r, clinicians)) {
                p.availableSecs += available(r);
                p.utilisedSecs += Number(r.utilised_secs) || 0;
                p.breakSecs += Number(r.rota_break_secs) || 0;
            } else {
                // Chair time worked outside the measurable window still
                // happened. It is kept out of the ratio and reported, never
                // dropped and never counted.
                p.utilisedSecs += 0;
            }
            const dayAvailable = countsTowardTime(r, clinicians) ? available(r) : 0;
            p.days.push({
                day: r.day,
                availableHours: round1(dayAvailable / HOUR),
                utilisedHours: round1((Number(r.utilised_secs) || 0) / HOUR),
                // Null, not zero, on a day with no measurable window: a dot
                // drawn at 0% would claim they sat idle when in fact we cannot
                // say anything about that day at all.
                utilisationPct: dayAvailable > 0
                    ? Math.round(((Number(r.utilised_secs) || 0) / dayAvailable) * 1000) / 10
                    : null,
                patientAppts: Number(r.patient_appts) || 0,
                revenuePence: r.revenue_pence == null ? null : Number(r.revenue_pence),
                rostered: r.rostered === null ? null : r.rostered === true,
            });
            byPract.set(id, p);
        }

        const practitioners = [...byPract.values()].map((p) => {
            const t = treatments.get(p.practitionerId) ?? null;
            const revenuePence = p.hasRevenue ? p.revenuePence : null;
            return {
                practitionerId: p.practitionerId,
                practitionerName: p.practitionerName,
                // The site most of their days were at — a label for the row,
                // not a claim that every day was there.
                practiceId: mostCommon(p.practices),

                // TIME
                daysWorked: p.daysWorked,
                daysRostered: p.daysRostered,
                availableHours: round1(p.availableSecs / HOUR),
                utilisedHours: round1(p.utilisedSecs / HOUR),
                unusedHours: round1(Math.max(0, p.availableSecs - p.utilisedSecs) / HOUR),
                breakHours: round1(p.breakSecs / HOUR),
                utilisationPct: p.availableSecs > 0
                    ? Math.round((p.utilisedSecs / p.availableSecs) * 1000) / 10
                    : null,

                // ACTIVITY
                patientAppts: p.patientAppts,
                apptsPerWorkedDay: p.daysWorked > 0 ? round1(p.patientAppts / p.daysWorked) : null,

                // TREATMENT — null throughout when the feed is unavailable, so
                // an absent column never reads as a clinician who did nothing.
                treatments: t ? t.treatments : (treatmentsAvailable ? 0 : null),
                treatmentPatients: t ? t.patients : (treatmentsAvailable ? 0 : null),
                treatmentValuePence: t ? t.valuePence : (treatmentsAvailable ? 0 : null),
                treatmentsPerUtilisedHour: t && p.utilisedSecs > 0
                    ? round1(t.treatments / (p.utilisedSecs / HOUR))
                    : null,
                // What they spend their days doing. Most REPEATED, by item
                // count — ranking by money would answer a different question
                // and hand back whichever single implant outweighed two
                // hundred check-ups.
                topTreatment: t ? t.topTreatment : null,
                topTreatmentCount: t ? t.topTreatmentCount : null,

                // MONEY — invoiced fees, distinct from treatment list value.
                revenuePence,
                revenuePerUtilisedHourPence: perHour(revenuePence, p.utilisedSecs),
                revenuePerAvailableHourPence: perHour(revenuePence, p.availableSecs),
                revenuePerDayPence: p.daysWorked > 0 && revenuePence != null
                    ? Math.round(revenuePence / p.daysWorked)
                    : null,

                days: p.days.sort((a, b) => a.day.localeCompare(b.day)),
            };
        });

        // Sorted by what the page is about. Revenue, not utilisation: a
        // clinician can be 100% utilised on cheap work.
        practitioners.sort((a, b) => (b.revenuePence ?? -1) - (a.revenuePence ?? -1));

        const sum = (k) => practitioners.reduce((a, p) => a + (p[k] ?? 0), 0);
        const availableHours = round1(sum('availableHours'));
        const utilisedHours = round1(sum('utilisedHours'));
        const anyRevenue = practitioners.some((p) => p.revenuePence != null);
        const revenuePence = anyRevenue ? sum('revenuePence') : null;

        // The group's daily series, summed from the practitioner days above so
        // the chart is a re-bucketing of the figures already computed rather
        // than a second pass that could drift from them.
        const byDay = new Map();
        for (const p of practitioners) {
            for (const d of p.days) {
                const g = byDay.get(d.day) ?? {
                    day: d.day, availableHours: 0, utilisedHours: 0,
                    patientAppts: 0, revenuePence: 0, hasRevenue: false, practitioners: new Set(),
                };
                g.availableHours += d.availableHours;
                g.utilisedHours += d.utilisedHours;
                g.patientAppts += d.patientAppts;
                if (d.revenuePence != null) { g.revenuePence += d.revenuePence; g.hasRevenue = true; }
                if (d.availableHours > 0 || d.patientAppts > 0) g.practitioners.add(p.practitionerId);
                byDay.set(d.day, g);
            }
        }
        const days = [...byDay.values()]
            .sort((a, b) => a.day.localeCompare(b.day))
            .map((d) => ({
                day: d.day,
                availableHours: round1(d.availableHours),
                utilisedHours: round1(d.utilisedHours),
                unusedHours: round1(Math.max(0, d.availableHours - d.utilisedHours)),
                utilisationPct: d.availableHours > 0
                    ? Math.round((d.utilisedHours / d.availableHours) * 1000) / 10
                    : null,
                patientAppts: d.patientAppts,
                revenuePence: d.hasRevenue ? d.revenuePence : null,
                practitioners: d.practitioners.size,
            }));

        return {
            window: { since, until },
            basis,
            days,
            // Said out loud so an absent column is explained rather than blank.
            treatmentsAvailable,
            // The practice's own top five, most repeated first.
            topTreatments: (topRows ?? []).map((r) => ({
                treatmentName: r.treatment_name,
                treatments: Number(r.treatments) || 0,
                patients: Number(r.patients) || 0,
                valuePence: Number(r.value_pence) || 0,
            })),
            totals: {
                practitioners: practitioners.length,
                daysWorked: sum('daysWorked'),
                availableHours,
                utilisedHours,
                unusedHours: round1(Math.max(0, availableHours - utilisedHours)),
                // RATIO OF SUMS, never the average of the per-practitioner
                // percentages - one part-timer at 100% must not weigh the same
                // as a full-timer at 40%.
                utilisationPct: availableHours > 0
                    ? Math.round((utilisedHours / availableHours) * 1000) / 10
                    : null,
                patientAppts: sum('patientAppts'),
                treatments: treatmentsAvailable ? sum('treatments') : null,
                treatmentValuePence: treatmentsAvailable ? sum('treatmentValuePence') : null,
                revenuePence,
                revenuePerUtilisedHourPence: perHour(revenuePence, utilisedHours * HOUR),
                revenuePerAvailableHourPence: perHour(revenuePence, availableHours * HOUR),
            },
            practitioners,
        };
    },
};
