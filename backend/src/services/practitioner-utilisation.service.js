// ============================================================================
// Practitioner utilisation — the rules that turn diary rows into a figure.
//
// Dentally's own guidance for rebuilding their view:
//   available = practitioner working hours from the calendar schedule
//   utilised  = appointments with a PATIENT attached
//   appointments with no patient are UNUSED time, not utilisation
//
// A CANCELLED OR MISSED SLOT IS AN EMPTY CHAIR, and the RPC excludes both from
// utilised time (they stay in the day span — the practitioner was rostered).
// This was wrong at first and was caught by checking one practitioner against
// Dentally's own tooltip: we reported 8h 30m used on 8 September where Dentally
// reported 5h 30m, and the difference was exactly that person's cancelled and
// did-not-attend slots. Across September, both organisations, it was 254
// cancellations (169.5 hours) and 43 no-shows (20.3 hours) counted as chairs in
// use. Group utilisation over the last 30 days fell from 71.9% to 59.6% once
// they were removed — the lower figure is the true one.
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
    // `basis` chooses the DENOMINATOR, and the page says which one is in use.
    //
    //   'span'     first to last of anything in the diary. Wide: a block at
    //              either end stretches it.
    //   'clinical' first to last appointment that saw a patient. Excludes the
    //              leading and trailing blocks that inflate the span.
    //   'rota'     the hours Dentally actually rostered the practitioner for.
    //              This IS Dentally's own denominator, and it reconciles: for
    //              practitioner 201099 on 21 September, Dentally showed 4h15
    //              utilised against a total of 3h00 (142%) while the clinical
    //              basis showed the same 4h15 against 9h30 (45%). The rota says
    //              3h00. A previous note here claimed the rota was unreachable;
    //              that was wrong, and only because GET
    //              /rota_practitioner_diaries needs `after` and `before`.
    //
    // Measured over September on this organisation: 55.9% on the span, 75.6%
    // on the clinical window. On the rota, over closed months: 43.4% (Nov 25),
    // 46.0% (Feb), 38.8% (Apr), 44.3% (Jun), 42.7% (Aug).
    async overview(orgId, { since, until, practiceId = null, basis = 'clinical' }) {
        const rows = await practitionerUtilisationRepository.daily(orgId, { since, until, practiceId });

        const norm = rows.map((r) => ({
            practitionerId: String(r.practitioner_id),
            practitionerName: r.practitioner_name,
            practiceId: r.practice_id ?? null,
            day: r.day,
            spanSecs: Number(r.available_secs) || 0,
            clinicalSecs: Number(r.clinical_secs) || 0,
            // NULL, not 0, all the way through: null means "no rostered window
            // for this day", which a zero would turn into an infinite
            // utilisation the moment anything divided by it.
            rotaSecs: r.rota_secs == null ? null : Number(r.rota_secs),
            rotaBreakSecs: r.rota_break_secs == null ? null : Number(r.rota_break_secs),
            // Three states. true = rostered and working, false = rostered OFF,
            // null = no rota row at all. The last two must not be collapsed:
            // one says the practice declared a day off, the other says we have
            // no rota for them.
            rostered: r.rostered == null ? null : r.rostered === true,
            // The denominator actually in use, chosen once here so every
            // figure below - cards, chart, grid - divides by the same thing.
            availableSecs: basis === 'span'
                ? (Number(r.available_secs) || 0)
                : basis === 'rota'
                    ? (r.rota_secs == null ? 0 : Number(r.rota_secs))
                    : (Number(r.clinical_secs) || 0),
            utilisedSecs: Number(r.utilised_secs) || 0,
            patientAppts: Number(r.patient_appts) || 0,
            blockAppts: Number(r.block_appts) || 0,
            // Null, never 0: a day with no invoicing has no revenue figure, and
            // "£0.00 earned" is a different claim from "nothing was invoiced".
            revenuePence: r.revenue_pence == null ? null : Number(r.revenue_pence),
        }));

        // Decision 1. Kept separately rather than filtered away silently.
        //
        // On the span and clinical bases a day with no patient has no window to
        // measure, so it is set aside. On the ROTA basis it is the opposite: a
        // rostered day where nobody was seen is exactly the unused capacity the
        // report exists to find, and dropping it would inflate every figure.
        // So the rota basis selects by PERSON over the window, then by whether
        // each day was rostered.
        let working;
        let blockOnly;
        let offRota = [];
        let noRota = [];
        if (basis === 'rota') {
            // A clinician is someone who treated at least one patient in this
            // window. Structural, not a threshold: the rota rosters every
            // member of staff, and this group has twenty rostered people who
            // treat nobody, each carrying about 235 hours a month. Divide by
            // all of them and August reads 16.8% instead of 42.7% - a
            // fabricated collapse, not a finding. A cut like "more than five
            // hours" would be a magic number that moves every figure on the
            // page depending on where it is set.
            const clinicians = new Set(norm.filter((r) => r.patientAppts > 0).map((r) => r.practitionerId));
            const theirs = norm.filter((r) => clinicians.has(r.practitionerId));
            working = theirs.filter((r) => r.rostered === true);
            // Real patient time on a day the rota calls off, and days we hold
            // no rota for. Both are REPORTED rather than folded into the ratio:
            // counting them in the numerator with no denominator would flatter
            // the figure, and dropping them silently would hide real work.
            // Measured at roughly 3% of used time (23.5h of 768h in August).
            offRota = theirs.filter((r) => r.rostered === false);
            noRota = theirs.filter((r) => r.rostered === null);
            blockOnly = norm.filter((r) => !clinicians.has(r.practitionerId));
        } else {
            working = norm.filter((r) => r.patientAppts > 0);
            blockOnly = norm.filter((r) => r.patientAppts === 0);
        }

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
                availableSecs: d.availableSecs,
                utilisedSecs: d.utilisedSecs,
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
                // EXACT seconds, carried alongside the rounded hours because a
                // figure rounded twice drifts. The grid tooltip prints hours
                // and minutes, and deriving those from a 1-decimal hour turned
                // a real 4h15m (255 min, which is what Dentally shows) into
                // 4.3h and then into "4h 18m" - three minutes invented by the
                // rounding, on every cell. Rendered units finer than the
                // rounding must come from here, never from the hours above.
                availableSecs: r.availableSecs,
                utilisedSecs: r.utilisedSecs,
                patientAppts: r.patientAppts,
                revenuePence: r.revenuePence,
            });
            byPract.set(r.practitionerId, p);
        }
        // Practitioners the report measures NOTHING for in this window: their
        // diary held only blocks, meetings or holidays. They are kept out of
        // every total (including them is what drags the group figure to 16.8%),
        // but they are LISTED, because "rostered and saw nobody" is the finding
        // this report exists to surface and dropping them hides it.
        //
        // Dentally lists them too: its picker offers everyone assigned to the
        // site. Nadia Reinolds has two ids - one at Barnet that treated six
        // patients, one at Rochester that treated none in eleven weeks - and
        // the Rochester one is exactly this case. Selecting her should show a
        // flat zero against the contracted line, not an absence from the menu.
        const otherByPract = new Map();
        for (const r of blockOnly) {
            const p = otherByPract.get(r.practitionerId) ?? {
                practitionerId: r.practitionerId,
                practitionerName: r.practitionerName,
                practices: [],
                availableSecs: 0,
                days: [],
            };
            p.practices.push(r.practiceId);
            p.availableSecs += r.availableSecs;
            p.days.push({
                day: r.day,
                practiceId: r.practiceId,
                // Zero used, and a REAL zero: they were in the diary and saw
                // nobody. Distinct from the nulls elsewhere, which mean "no
                // window to measure".
                utilisationPct: r.availableSecs > 0 ? 0 : null,
                availableHours: Math.round((r.availableSecs / HOUR) * 10) / 10,
                utilisedHours: 0,
                availableSecs: r.availableSecs,
                utilisedSecs: 0,
                patientAppts: 0,
                revenuePence: r.revenuePence,
            });
            otherByPract.set(r.practitionerId, p);
        }
        const otherPractitioners = [...otherByPract.values()]
            .map((p) => ({
                practitionerId: p.practitionerId,
                practitionerName: p.practitionerName,
                practiceId: mostCommon(p.practices),
                daysWorked: 0,
                availableHours: Math.round((p.availableSecs / HOUR) * 10) / 10,
                utilisedHours: 0,
                availableSecs: p.availableSecs,
                utilisedSecs: 0,
                utilisationPct: p.availableSecs > 0 ? 0 : null,
                patientAppts: 0,
                revenuePence: null,
                revenuePerUtilisedHourPence: null,
                days: p.days.sort((a, b) => a.day.localeCompare(b.day)),
            }))
            .sort((a, b) => a.practitionerName.localeCompare(b.practitionerName));

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
                availableSecs: p.availableSecs,
                utilisedSecs: p.utilisedSecs,
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
            basis,
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
                // Rota basis only, and zero on the others by construction. Named
                // so the panel reconciles instead of quietly absorbing the
                // difference: rostered hours, plus work done off the rota, plus
                // days we hold no rota for, account for everything.
                offRotaDays: offRota.length,
                offRotaUtilisedHours: Math.round((sum(offRota, 'utilisedSecs') / HOUR) * 10) / 10,
                noRotaDays: noRota.length,
                noRotaUtilisedHours: Math.round((sum(noRota, 'utilisedSecs') / HOUR) * 10) / 10,
                // Breaks sit INSIDE the rostered window above, so the headline
                // is gross of them - which is what reconciled against Dentally.
                // Stated here so net can be read off without a second query.
                rotaBreakHours: Math.round((working.reduce((a, r) => a + (r.rotaBreakSecs ?? 0), 0) / HOUR) * 10) / 10,
            },
            days,
            practitioners,
            // Listed but never counted — see the note where this is built.
            otherPractitioners,
        };
    },
};
