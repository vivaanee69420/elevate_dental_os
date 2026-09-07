// ============================================================================
// Paid marketing summary — ONE set of ad numbers for the Command Centre and
// Business Hub, computed where the Facebook and Google report pages compute
// theirs.
//
// WHY THIS EXISTS. /growth/marketing/roi counted "ad leads" like this:
//
//     const adLeadProxy = adLeads || totals.conversions;
//
// `adLeads` comes from a UTM/source regex over CRM leads, and this org's
// GoHighLevel leads carry no UTMs at all (see the ad-lead-fetch spike: 29,491
// leads, zero UTMs), so that term is structurally 0. The fallback is a sum of
// `ad_metrics.conversions` — the AD PLATFORMS' own conversion counts, which are
// modelled, fractional and count EVENTS, not people. Measured live (Ashford,
// Jun-Aug 2026) the card read "4,692.66 ad leads" — the fraction is the tell —
// and GBP 7.33 per lead against GBP 34,419.64 of spend. The ledgers the report
// pages already use say 735 leads (155 Google + 580 Meta): GBP 46.83 each. The
// card was ~6.4x too cheap and reconciled against nothing.
//
// The fix is COMPOSITION, not a fourth definition of a lead. Both report
// services already publish per-practice rows through the same shared
// lead-performance arithmetic; this asks them and sums the result with the same
// sumPracticeRows(). A lead here is exactly what those pages say it is, so the
// Command Centre cannot drift from the page a reader would check it against.
//
// KNOWN, MEASURED OVERLAP. The two ledgers identify their leads independently —
// Google by a GoHighLevel pipeline mapped to the google_ads channel (plus
// CallRail calls), Meta structurally by the contact's ad_id resolving to a Meta
// campaign in this org's own ad_metrics — so a contact sitting in a
// google-mapped pipeline while carrying a Meta ad_id would be counted twice.
// Measured on the live org over Jun-Aug 2026: 267 google-pipeline leads, of
// which 5 carry any ad_id and exactly 1 resolves to a Meta ad. One lead in
// ~2,500 is below the precision of every figure on the card, and deduplicating
// across providers here would mean inventing a cross-provider identity rule
// that neither report page applies — which is how the two would start
// disagreeing. Stated rather than silently handled.
// ============================================================================
import { googleReportService } from './google-report.service.js';
import { facebookReportService } from './facebook-report.service.js';
import { sumPracticeRows } from '../lib/marketing/lead-performance.js';

const PROVIDERS = [
    { provider: 'google_ads', run: (orgId, args) => googleReportService.leadPerformance(orgId, args) },
    { provider: 'meta_ads', run: (orgId, args) => facebookReportService.leadPerformance(orgId, args) },
];

// A platform reports itself as connected or not; anything that is not an
// outright "no accounts" still counts as connected, because "connected but
// nothing synced yet" and "connected but quiet this window" are both states the
// report pages distinguish and neither means "we do not run this channel".
const CONNECTED_STATES = (state) => state != null && state !== 'not_connected';

export async function paidMarketingSummary(orgId, { since, until, practiceId = null } = {}) {
    const args = { since, until, practiceId };
    const settled = await Promise.allSettled(PROVIDERS.map((p) => p.run(orgId, args)));

    const providers = [];
    const mapped = [];
    let unmappedSpendPence = 0;
    let unmappedLeads = 0;

    settled.forEach((r, i) => {
        const { provider } = PROVIDERS[i];
        if (r.status === 'rejected') {
            // One platform's outage must not blank the other's real numbers.
            // Reported as 'error' rather than folded into 0, so a blended CPL
            // is never quietly computed over half the spend.
            providers.push({ provider, state: 'error', spendPence: 0, leads: 0, booked: 0, accepted: 0, cplPence: null, cpbPence: null, cpaPence: null });
            return;
        }
        const rows = r.value?.practices ?? [];
        // A practiceId=null row is spend whose ad account maps to no practice.
        // On a report page that is a visible "Unmapped" ROW; on a single card it
        // would be invisible, so it is kept out of the total and reported
        // beside it. On the live org it is GBP 18,596.74 of a manager account's
        // other businesses that produced zero leads in this tenant's ledger —
        // folding it in inflates group cost per lead by ~18% for no lead.
        for (const row of rows) {
            if (row.practiceId == null) {
                unmappedSpendPence += Number(row.spendPence ?? 0);
                unmappedLeads += Number(row.leads ?? 0);
                continue;
            }
            mapped.push(row);
        }
        const own = sumPracticeRows(rows.filter((row) => row.practiceId != null));
        providers.push({ provider, state: r.value?.state ?? 'unknown', ...own });
    });

    return {
        // "Any platform connected", not "any spend" — a connected platform with
        // a quiet window still owns this card; an org running no ads at all
        // should not see it.
        connected: providers.some((p) => CONNECTED_STATES(p.state) && p.state !== 'error'),
        // withLeadCosts via sumPracticeRows: a cost per nothing is null, never
        // a confident GBP 0.00 (formatPence renders 0 and null very
        // differently, and only one of them is honest here).
        total: sumPracticeRows(mapped),
        providers,
        unmappedSpendPence,
        unmappedLeads,
    };
}
