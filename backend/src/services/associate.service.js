// ============================================================================
// Associate service — merges the roster with appointment stats + production/UDA/
// conversion metrics (migration 000080) and bands a status. Production is REAL
// invoiced fees (invoice_items); UDAs are completed NHS units; conversion is
// treatment-plan completed/total. All scoped to the rolling window.
// ============================================================================
import { associateRepository } from "../repositories/associate.repository.js";
import { associateStatus } from "../lib/associate-status.js";

export const associateService = {
    async list(orgId, { practice_id, weeks }) {
        const since = new Date(Date.now() - (weeks ?? 52) * 7 * 86400000).toISOString();
        const [roster, stats, metrics] = await Promise.all([
            associateRepository.list(orgId, practice_id),
            associateRepository.appointmentStatsByAssociate(orgId, since),
            associateRepository.metricsByAssociate(orgId, since),
        ]);

        // Collapse the many practitioner records for one clinician into a single
        // row. Dentally fragments a person across sites AND sometimes mints several
        // accounts (distinct user.id) for the same human at the same practice — e.g.
        // a stale empty "Amit Coonar" alongside the active one. Grouping on user.id
        // can't merge the latter, so key on the normalised NAME (the human), which
        // merges every record for that clinician and sums their metrics. Manual rows
        // with no name fall back to their own id so they never merge.
        // Normalise a name to a person key. Dentally holds the SAME human under many
        // variant labels — "mr. Gaurav Mehta", "Gaurav(ASH) Mehta", "Gaurav Mehta do
        // not use" are one person whose appointments live on one record and invoices
        // on another. Exact-name grouping fragments them (a row with production but 0
        // appts, etc.). Strip titles, parenthetical site tags, the "do not use"
        // marker, and all punctuation/digits so every variant collapses to one key.
        const normName = (name) => {
            let s = String(name || '').toLowerCase();
            s = s.replace(/\([^)]*\)/g, ' ');                       // (ASH) and other tags
            s = s.replace(/\bdo not use\b/g, ' ');                  // deprecated-account marker
            s = s.replace(/[^a-z\s]/g, ' ');                        // punctuation + digits ("mr." -> "mr")
            s = s.replace(/\b(mr|mrs|ms|miss|mx|dr|prof)\b/g, ' '); // honorifics
            return s.replace(/\s+/g, ' ').trim();
        };
        const nameKey = (a) => normName(a.full_name) || `solo:${a.id}`;
        const groups = new Map();
        for (const a of roster) {
            const key = nameKey(a);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(a);
        }

        const firstNonNull = (rows, pick) => { for (const r of rows) { const v = pick(r); if (v != null && v !== '') return v; } return null; };
        // Fee-earning clinical roles. A row survives the noise filter below if it has
        // a clinical role OR any real activity — so a mis-roled clinician (a "Nurse"
        // with production) is kept, while empty admin/reception accounts drop out.
        const isClinical = (role) => /dentist|hygien|therap/.test(String(role || '').toLowerCase());
        // Junk placeholder accounts (e.g. "Dr Notes Notes", "X do not use"). A name
        // that reduces to a single repeated token, or carries an explicit marker, is a
        // test/dead record — dropped when it has no activity to back it up.
        const isJunkName = (name) => {
            if (/\b(do not use|test account|dummy)\b/.test(String(name || '').toLowerCase())) return true;
            const parts = normName(name).split(' ').filter(Boolean);
            return parts.length >= 2 && new Set(parts).size === 1;
        };

        const out = [];
        for (const rows of groups.values()) {
            const agg = { total: 0, completed: 0, no_shows: 0, production: 0, uda: 0, plansTotal: 0, plansCompleted: 0 };
            const practices = [];
            let udaTarget = null;
            let joined = null;
            let active = false;
            let feeEarner = false;
            // Canonical display row = the busiest, non-junk variant (so "mr. Gaurav
            // Mehta" wins over "Gaurav(ASH) Mehta" / "… do not use").
            let canonical = rows[0];
            let canonScore = -1;
            for (const a of rows) {
                if (isClinical(a.dentally_role)) feeEarner = true;
                const s = stats.get(a.id) ?? { total: 0, completed: 0, no_shows: 0 };
                const m = metrics.get(a.id) ?? { production_pence: 0, uda_delivered: 0, plans_total: 0, plans_completed: 0 };
                agg.total += s.total; agg.completed += s.completed; agg.no_shows += s.no_shows;
                agg.production += m.production_pence; agg.uda += m.uda_delivered;
                agg.plansTotal += m.plans_total; agg.plansCompleted += m.plans_completed;
                const pn = a.practice?.name ?? null;
                if (pn && !practices.includes(pn)) practices.push(pn);
                if (a.uda_target != null) udaTarget = (udaTarget ?? 0) + a.uda_target;
                if (a.joined_date && (!joined || a.joined_date < joined)) joined = a.joined_date;
                if (a.active !== false) active = true;
                // Prefer a clean label (no junk, no "(ASH)"-style tag); tie-break by
                // activity so the real working account's name + id represent the row.
                const clean = !isJunkName(a.full_name) && !/[()]/.test(a.full_name);
                const score = (clean ? 1e12 : 0) + s.total + m.production_pence / 1000;
                if (score > canonScore) { canonScore = score; canonical = a; }
            }
            const completion_pct = agg.total ? Math.round((100 * agg.completed) / agg.total) : null;
            const no_show_pct = agg.total ? Math.round((100 * agg.no_shows) / agg.total) : null;
            // Conversion = treatment plans completed / started (the only acceptance
            // proxy Dentally exposes). null when the person has no plans in window.
            const conversion = agg.plansTotal ? Math.round((100 * agg.plansCompleted) / agg.plansTotal) : null;
            // Drop pure-noise rows when they have ZERO activity in the window: either
            // a non-clinical account (admin/reception) or a junk placeholder ("Dr
            // Notes Notes", "… do not use"). Anyone with any appointment or production
            // stays regardless, so no real earner is ever hidden.
            const noActivity = agg.total === 0 && agg.production === 0;
            const junk = rows.some((r) => isJunkName(r.full_name));
            if (noActivity && (!feeEarner || junk)) continue;
            const payPct = firstNonNull(rows, (r) => r.pay_pct);
            out.push({
                id: canonical.id,
                full_name: canonical.full_name,
                practice: practices[0] ?? null,
                practices,
                practice_count: practices.length,
                pay_pct: payPct != null ? payPct / 100 : null,
                joined_date: joined,
                active,
                gdc_number: firstNonNull(rows, (r) => r.gdc_number),
                colour: firstNonNull(rows, (r) => r.colour),
                role: firstNonNull(rows, (r) => r.dentally_role),
                uda_target: udaTarget,
                treatments: agg.completed,
                appointments_total: agg.total,
                no_shows: agg.no_shows,
                completion_pct,
                no_show_pct,
                status: associateStatus({ completionPct: completion_pct, total: agg.total }),
                // Real money (pence) — 0 -> null so the UI shows "—" for clinicians
                // with no invoiced production in the window (e.g. nurses).
                ttm_production: agg.production || null,
                ttm_uda: agg.uda ? Math.round(agg.uda) : null,
                conversion,
            });
        }
        // Stable alphabetical order (repo's per-row ordering is lost on grouping).
        out.sort((a, b) => a.full_name.localeCompare(b.full_name));
        return out;
    },
};
