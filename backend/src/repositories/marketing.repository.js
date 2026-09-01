// Marketing data access — queries in, rows out. No logic here.
// serviceClient has NO automatic isolation: every query filters
// organisation_id explicitly (rule 3).
import * as supabase_1 from '../lib/supabase.js';
import { londonYmd } from '../lib/tz.js';

export const marketingRepository = {
    // Spend per campaign per provider over the window. ad_metrics is campaign x
    // day; this collapses it to campaign. Paginated: PostgREST caps reads at
    // 1000 rows and a 6-month window across several accounts exceeds that.
    async campaignSpend(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const out = [];
        for (let from = 0; ; from += PAGE) {
            let q = supabase_1.serviceClient
                .from('ad_metrics')
                .select('provider, customer_id, campaign_id, campaign_name, spend_pence, impressions, clicks, conversions')
                .eq('organisation_id', orgId)
                // metric_date is a DATE while the scope window is an ISO
                // instant with an EXCLUSIVE until. The instant must be resolved
                // to its LONDON calendar date, never sliced: the scope bar emits
                // 2026-07-31T23:00:00Z for the start of August under BST, and a
                // slice would read that as 31 July — pulling in a day of July
                // spend and, at the other end, excluding 31 August. Spend and
                // ad_lead_conversions would then be measured over different
                // days and every cost-per-lead figure would be wrong. The
                // half-open comparison itself is right and is kept.
                .gte('metric_date', londonYmd(since))
                .lt('metric_date', londonYmd(until))
                .range(from, from + PAGE - 1);
            if (practiceId) q = q.eq('practice_id', practiceId);
            const { data, error } = await q;
            if (error) throw new Error(`ad_metrics read: ${error.message}`);
            const rows = data ?? [];
            out.push(...rows);
            if (rows.length < PAGE) break;
        }
        // Collapse campaign x day -> campaign.
        const byCampaign = new Map();
        for (const r of out) {
            const k = `${r.provider}|${r.campaign_id}`;
            const e = byCampaign.get(k) ?? {
                provider: r.provider, customer_id: r.customer_id, campaign_id: r.campaign_id,
                campaign_name: r.campaign_name, spend_pence: 0, impressions: 0, clicks: 0, conversions: 0,
            };
            e.spend_pence += Number(r.spend_pence ?? 0);
            e.impressions += Number(r.impressions ?? 0);
            e.clicks += Number(r.clicks ?? 0);
            e.conversions += Number(r.conversions ?? 0);
            if (!e.campaign_name && r.campaign_name) e.campaign_name = r.campaign_name;
            byCampaign.set(k, e);
        }
        return [...byCampaign.values()];
    },

    // Leads with their attribution and whether they became a Dentally patient.
    //
    // PAGINATED, and it must be. PostgREST's 1000-row cap applies to a
    // set-returning FUNCTION exactly as it does to a table — the result is
    // exposed as a relation — so a plain `.rpc()` silently returned the first
    // 1000 leads and nothing said so. Plan4growth's August 2026 window holds
    // 1,222; the screen showed "Leads 1,000" and, because the truncation cut
    // the converted rows too, 44 patients against a true 122. A round number
    // in a KPI tile is the tell.
    //
    // Ordering is what makes paging sound: OFFSET without ORDER BY may return
    // the same row twice and skip another. The function emits exactly one row
    // per contact (its lead_contacts CTE is DISTINCT on contact columns), so
    // contact_id is a unique, stable sort key.
    async leadsByCampaign(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const rows = [];
        for (let from = 0; ; ) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_lead_conversions', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                .order('contact_id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_lead_conversions: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Advance by what the server actually returned and stop only on an
            // EMPTY page, never on a short one. The server's cap is its own
            // setting: if it were below PAGE, treating a short page as the last
            // page would reintroduce the very truncation this fixes, just at a
            // different number. Costs one extra round trip; buys immunity.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            contact_id: r.contact_id,
            converted: r.converted === true,
        }));
    },
};
